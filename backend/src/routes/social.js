import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requirePermission, HttpError } from '../middleware/auth.js';
import { notify } from '../services/notify.js';
import { logAudit } from '../services/audit.js';

const router = Router();

// Images des publications : stockées à part des documents de dossier (accès public en lecture,
// puisque le fil d'accueil est visible sans authentification).
export const POST_IMAGES_DIR = join(resolve(process.env.UPLOAD_DIR ?? './uploads'), 'post-images');
mkdirSync(POST_IMAGES_DIR, { recursive: true });
const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8 Mo
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, POST_IMAGES_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_IMAGE_EXT.has(ext)) return cb(new HttpError(400, 'invalid_file_type', `Type d’image non autorisé : ${ext || 'inconnu'}.`));
    cb(null, true);
  },
});
const handleImageUpload = (req, res, next) => imageUpload.single('image')(req, res, (err) => {
  if (err instanceof multer.MulterError) return next(new HttpError(400, 'upload_error', err.code === 'LIMIT_FILE_SIZE' ? 'Image trop volumineuse (8 Mo max).' : err.message));
  if (err) return next(err);
  next();
});
const imageUrl = (p) => (p.image_filename ? `/uploads/post-images/${p.image_filename}` : null);

// Public read-only feed: visitors can see the cabinet's published content
// without creating an account or entering a password. Interactions remain protected.
router.get('/public/posts', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT p.*, u.first_name, u.last_name, r.name AS role,
        (SELECT COUNT(*) FROM post_likes l WHERE l.post_id=p.id) AS likes,
        (SELECT COUNT(*) FROM post_comments c WHERE c.post_id=p.id) AS comments
      FROM posts p
      JOIN users u ON u.id=p.author_id
      JOIN roles r ON r.id=u.role_id
      ORDER BY p.created_at DESC
      LIMIT 100`);
    res.json(rows.map((p) => ({
      id: p.id, title: p.title, content: p.content, type: p.type, imageUrl: imageUrl(p),
      author: { id: p.author_id, firstName: p.first_name, lastName: p.last_name, role: p.role },
      createdAt: p.created_at, updatedAt: p.updated_at,
      likes: Number(p.likes ?? 0), comments: Number(p.comments ?? 0),
      likedByMe: false, canEdit: false, canDelete: false,
    })));
  } catch (e) { next(e); }
});

router.use(requireAuth);

const postShape = (p, currentUserId) => ({
  id: p.id, title: p.title, content: p.content, type: p.type, imageUrl: imageUrl(p),
  author: { id: p.author_id, firstName: p.first_name, lastName: p.last_name, role: p.role },
  createdAt: p.created_at, updatedAt: p.updated_at,
  likes: Number(p.likes ?? 0), comments: Number(p.comments ?? 0), likedByMe: Boolean(p.liked_by_me),
  canEdit: Number(p.author_id) === Number(currentUserId),
  canDelete: Number(p.author_id) === Number(currentUserId),
});

router.get('/posts', requirePermission('posts.read'), async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT p.*, u.first_name, u.last_name, r.name AS role,
        (SELECT COUNT(*) FROM post_likes l WHERE l.post_id=p.id) AS likes,
        (SELECT COUNT(*) FROM post_comments c WHERE c.post_id=p.id) AS comments,
        EXISTS(SELECT 1 FROM post_likes lm WHERE lm.post_id=p.id AND lm.user_id=$1) AS liked_by_me
      FROM posts p JOIN users u ON u.id=p.author_id JOIN roles r ON r.id=u.role_id
      ORDER BY p.created_at DESC LIMIT 100`, [req.user.id]);
    res.json(rows.map((p) => postShape(p, req.user.id)));
  } catch (e) { next(e); }
});

const postSchema = z.object({ title: z.string().trim().min(1).max(180), content: z.string().trim().min(1).max(20000), type: z.enum(['POST','ARTICLE']).default('POST') });
router.post('/posts', requirePermission('posts.create'), handleImageUpload, async (req, res, next) => {
  try {
    const b = postSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO posts (author_id,title,content,type,image_filename,image_mime) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id,b.title,b.content,b.type,req.file?.filename ?? null,req.file?.mimetype ?? null],
    );
    await logAudit({ userId:req.user.id, action:'POST_CREATED', resourceType:'post', resourceId:rows[0].id, ip:req.ip });
    res.status(201).json(postShape({...rows[0], first_name:req.user.firstName,last_name:req.user.lastName,role:req.user.role,likes:0,comments:0,liked_by_me:false}, req.user.id));
  } catch(e){ next(e instanceof z.ZodError ? new HttpError(400,'invalid_body',e.issues[0].message):e); }
});

router.patch('/posts/:id', requirePermission('posts.update_own'), handleImageUpload, async (req,res,next)=>{
  try {
    const b=postSchema.partial().parse(req.body);
    const {rows:before}=await query('SELECT * FROM posts WHERE id=$1',[req.params.id]);
    if(!before[0]) throw new HttpError(404,'not_found','Publication introuvable.');
    if(Number(before[0].author_id)!==Number(req.user.id)) throw new HttpError(403,'forbidden','Seul l’auteur peut modifier cette publication.');
    // Si une nouvelle image est envoyée, elle remplace l'ancienne (le fichier précédent est supprimé du disque).
    const removeImage = req.body.removeImage === 'true';
    const newImageFilename = req.file ? req.file.filename : (removeImage ? null : before[0].image_filename);
    const newImageMime = req.file ? req.file.mimetype : (removeImage ? null : before[0].image_mime);
    if ((req.file || removeImage) && before[0].image_filename) {
      const oldPath = join(POST_IMAGES_DIR, before[0].image_filename);
      if (existsSync(oldPath)) unlinkSync(oldPath);
    }
    const {rows}=await query(
      `UPDATE posts SET title=COALESCE($1,title), content=COALESCE($2,content), type=COALESCE($3,type), image_filename=$4, image_mime=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$6 RETURNING *`,
      [b.title,b.content,b.type,newImageFilename,newImageMime,req.params.id],
    );
    res.json({...rows[0], imageUrl: imageUrl(rows[0])});
  }catch(e){next(e instanceof z.ZodError?new HttpError(400,'invalid_body',e.issues[0].message):e)}
});

router.delete('/posts/:id', requirePermission('posts.delete_own'), async(req,res,next)=>{
  try{
    const {rows}=await query('SELECT * FROM posts WHERE id=$1',[req.params.id]);
    if(!rows[0]) throw new HttpError(404,'not_found','Publication introuvable.');
    if(Number(rows[0].author_id)!==Number(req.user.id)) throw new HttpError(403,'forbidden','Seul l’auteur peut supprimer cette publication.');
    await query('DELETE FROM posts WHERE id=$1',[req.params.id]);
    if (rows[0].image_filename) {
      const p = join(POST_IMAGES_DIR, rows[0].image_filename);
      if (existsSync(p)) unlinkSync(p);
    }
    res.status(204).end();
  }catch(e){next(e)}
});

router.post('/posts/:id/like', requirePermission('posts.interact'), async(req,res,next)=>{
  try{
    const {rows:p}=await query('SELECT author_id FROM posts WHERE id=$1',[req.params.id]);
    if(!p[0]) throw new HttpError(404,'not_found','Publication introuvable.');
    const {rows:existing}=await query('SELECT 1 FROM post_likes WHERE post_id=$1 AND user_id=$2',[req.params.id,req.user.id]);
    if(existing[0]) await query('DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2',[req.params.id,req.user.id]);
    else { await query('INSERT INTO post_likes(post_id,user_id) VALUES($1,$2)',[req.params.id,req.user.id]); if(Number(p[0].author_id)!==Number(req.user.id)) await notify(p[0].author_id,{type:'POST_LIKE',title:'Votre publication a reçu un J’aime',body:`${req.user.firstName} ${req.user.lastName} a aimé votre publication.`}); }
    const {rows:c}=await query('SELECT COUNT(*) AS n FROM post_likes WHERE post_id=$1',[req.params.id]);
    res.json({liked:!existing[0],likes:Number(c[0].n)});
  }catch(e){next(e)}
});

router.get('/posts/:id/comments', requirePermission('posts.interact'), async(req,res,next)=>{try{const {rows}=await query(`SELECT c.id,c.content,c.created_at,u.id AS user_id,u.first_name,u.last_name,r.name AS role FROM post_comments c JOIN users u ON u.id=c.user_id JOIN roles r ON r.id=u.role_id WHERE c.post_id=$1 ORDER BY c.created_at ASC`,[req.params.id]);res.json(rows.map(c=>({id:c.id,content:c.content,createdAt:c.created_at,user:{id:c.user_id,firstName:c.first_name,lastName:c.last_name,role:c.role}})));}catch(e){next(e)}});
router.post('/posts/:id/comments', requirePermission('posts.interact'), async(req,res,next)=>{try{const content=z.string().trim().min(1).max(5000).parse(req.body.content);const {rows:p}=await query('SELECT author_id FROM posts WHERE id=$1',[req.params.id]);if(!p[0])throw new HttpError(404,'not_found','Publication introuvable.');const {rows}=await query('INSERT INTO post_comments(post_id,user_id,content) VALUES($1,$2,$3) RETURNING *',[req.params.id,req.user.id,content]);if(Number(p[0].author_id)!==Number(req.user.id))await notify(p[0].author_id,{type:'POST_COMMENT',title:'Nouveau commentaire',body:`${req.user.firstName} ${req.user.lastName} a commenté votre publication.`});res.status(201).json(rows[0]);}catch(e){next(e instanceof z.ZodError?new HttpError(400,'invalid_body','Commentaire invalide.'):e)}});

router.get('/messages/users', requirePermission('messages.read'), async(req,res,next)=>{try{const {rows}=await query(`SELECT u.id,u.first_name,u.last_name,u.email,r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id<>$1 AND u.is_active=1 ORDER BY u.first_name,u.last_name`,[req.user.id]);res.json(rows);}catch(e){next(e)}});
router.get('/messages/:userId', requirePermission('messages.read'), async(req,res,next)=>{try{const other=Number(req.params.userId);const {rows}=await query(`SELECT m.*,su.first_name AS sender_first_name,su.last_name AS sender_last_name FROM messages m JOIN users su ON su.id=m.sender_id WHERE (m.sender_id=$1 AND m.recipient_id=$2) OR (m.sender_id=$2 AND m.recipient_id=$1) ORDER BY m.created_at ASC LIMIT 200`,[req.user.id,other]);await query('UPDATE messages SET is_read=1 WHERE sender_id=$1 AND recipient_id=$2',[other,req.user.id]);res.json(rows.map(m=>({id:m.id,content:m.content,createdAt:m.created_at,isRead:Boolean(m.is_read),mine:Number(m.sender_id)===Number(req.user.id),sender:{id:m.sender_id,firstName:m.sender_first_name,lastName:m.sender_last_name}})));}catch(e){next(e)}});
router.post('/messages', requirePermission('messages.send'), async(req,res,next)=>{try{const b=z.object({recipientId:z.coerce.number().int().positive(),content:z.string().trim().min(1).max(10000)}).parse(req.body);if(b.recipientId===req.user.id)throw new HttpError(400,'invalid_recipient','Destinataire invalide.');const {rows:u}=await query('SELECT id,is_active FROM users WHERE id=$1',[b.recipientId]);if(!u[0]||!u[0].is_active)throw new HttpError(404,'not_found','Destinataire introuvable.');const {rows}=await query('INSERT INTO messages(sender_id,recipient_id,content) VALUES($1,$2,$3) RETURNING *',[req.user.id,b.recipientId,b.content]);await notify(b.recipientId,{type:'DIRECT_MESSAGE',title:'Nouveau message',body:`${req.user.firstName} ${req.user.lastName} vous a envoyé un message.`});res.status(201).json(rows[0]);}catch(e){next(e instanceof z.ZodError?new HttpError(400,'invalid_body',e.issues[0].message):e)}});

export default router;
