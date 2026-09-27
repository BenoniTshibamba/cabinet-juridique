import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { HttpError, requireAuth, requirePermission } from '../middleware/auth.js';
import { notifyMany } from '../services/notify.js';

const router=Router();
const requestSchema=z.object({email:z.string().email(),firstName:z.string().min(1).max(100),lastName:z.string().min(1).max(100),message:z.string().max(2000).optional()});
router.post('/',async(req,res,next)=>{try{const b=requestSchema.parse(req.body);const {rows:existing}=await query('SELECT id FROM users WHERE email=$1 UNION ALL SELECT id FROM registration_requests WHERE email=$1 AND status=\'PENDING\' LIMIT 1',[b.email.toLowerCase()]);if(existing[0])throw new HttpError(409,'registration_exists','Une demande ou un compte existe déjà pour cette adresse.');const {rows}=await query('INSERT INTO registration_requests(email,first_name,last_name,message) VALUES($1,$2,$3,$4) RETURNING id,created_at',[b.email.toLowerCase(),b.firstName,b.lastName,b.message||null]);res.status(201).json({id:rows[0].id,message:'Votre demande a été envoyée. Un administrateur doit l’approuver avant l’accès.'});}catch(e){next(e instanceof z.ZodError?new HttpError(400,'invalid_body',e.issues[0].message):e)}});
router.get('/',requireAuth,requirePermission('users.read'),async(req,res,next)=>{try{const {rows}=await query('SELECT * FROM registration_requests ORDER BY created_at DESC');res.json(rows);}catch(e){next(e)}});
export default router;
