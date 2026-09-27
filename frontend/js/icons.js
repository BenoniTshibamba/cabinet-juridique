const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z',
  clients: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 8a3 3 0 1 1 0 6M16 14c2.5 0 5 1.8 5 6',
  cases: 'M4 7h16v13H4zM4 7l2-3h12l2 3M9 11h6',
  documents: 'M7 3h7l4 4v14H7zM14 3v4h4M9 13h6M9 16h6',
  billing: 'M4 6h16v12H4zM4 10h16M8 15h3',
  messages: 'M4 5h16v11H8l-4 4z',
  bell: 'M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 19a2 2 0 0 0 4 0',
  audit: 'M5 4h14v16H5zM9 4v16M13 9h4M13 13h4M13 17h4',
  users: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.3 2.6-6 6-6s6 2.7 6 6M16 8a3 3 0 1 1 0 6M16 14c2.5 0 6 1.5 6 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  chevronDown: 'm6 9.5 6 6 6-6',
  chevronLeft: 'm14.5 6-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  logout: 'M9 4H5v16h4M14 8l4 4-4 4M18 12H9',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5 3.5 3.5M19 19l-1.5-1.5M5 19l-1.5 1.5M19 5l1.5-1.5M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  download: 'M12 4v11M7 11l5 5 5-5M5 19h14',
  trash: 'M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13',
  check: 'm5 12 5 5 9-9',
  close: 'm6 6 12 12M18 6 6 18',
  file: 'M7 3h7l4 4v14H7z',
};
export function icon(name, cls = 'icon') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? '');
  svg.append(path);
  return svg;
}
