import {validateEquipment,validateReport,validateTransition,isActive} from "./domain.mjs";
const DB_KEY="savio-tech-demo-v1", SESSION_KEY="savio-tech-demo-session-v1";
export const DEMO_USERS=Object.freeze({student:{id:"demo-student",role:"student",display_name:"Estudiante de prueba"},admin:{id:"demo-admin",role:"admin",display_name:"Docente de prueba"}});
const id=()=>globalThis.crypto?.randomUUID?.() ?? `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createDemoSeed(now=new Date()) {
  const date=days=>new Date(now.getTime()-days*86400000).toISOString();
  const equipment=[1,2,3,4,5,6,7,9,10,11,12].map(n=>({id:`pc-${n}`,code:`LAB-${String(n).padStart(2,"0")}`,name:`Computadora ${String(n).padStart(2,"0")}`,location:n<=6?"Laboratorio · fila A":"Laboratorio · fila B",specs:"Equipo de demostración",enabled:true,created_at:date(10)}));
  const cases=[
    [1006,3,"Software","El programa se cierra inesperadamente","Al abrir el editor de texto, el programa se cierra después de unos segundos.","pending","demo-student",0,""],
    [1005,9,"Conectividad","No conecta a internet","El navegador muestra que no hay conexión a internet.","in_progress","demo-other",1,""],
    [1004,6,"Teclado y mouse","Algunas teclas no responden","Las teclas A y S no escriben al utilizarlas en el editor.","pending","demo-other",2,""],
    [1003,5,"Rendimiento","Inicio de sesión muy lento","El escritorio tarda varios minutos en cargar al iniciar la sesión.","resolved","demo-student",3,"Se desactivaron aplicaciones de inicio innecesarias y se verificó el arranque."],
    [1002,1,"Pantalla","La pantalla no muestra imagen","La computadora enciende pero la pantalla permanece sin imagen.","resolved","demo-other",4,"Se ajustó el cable de video y se verificó la imagen."],
    [1001,3,"Software","No abre el navegador","Al hacer doble clic en el navegador no se abre ninguna ventana.","resolved","demo-student",6,"Se actualizó el navegador y se verificó su apertura."]
  ];
  const reports=cases.map(([n,pc,category,title,description,status,reporter_id,days,solution])=>({id:`report-${n}`,report_number:n,equipment_id:`pc-${pc}`,category,title,description,status,reporter_id,solution,created_at:date(days),updated_at:date(Math.max(0,days-1)),resolved_at:status==="resolved"?date(Math.max(0,days-1)):null}));
  const events=reports.flatMap(r=>{
    const arr=[{id:id(),report_id:r.id,status:"pending",note:"Reporte recibido.",actor_label:"Estudiante",created_at:r.created_at}];
    if(r.status!=="pending")arr.push({id:id(),report_id:r.id,status:"in_progress",note:"Se inició la revisión del equipo.",actor_label:"Administrador",created_at:r.updated_at});
    if(r.status==="resolved")arr.push({id:id(),report_id:r.id,status:"resolved",note:r.solution,actor_label:"Administrador",created_at:r.updated_at});
    return arr;
  });
  return {version:1,equipment,reports,events};
}

export class DemoService {
  constructor(storage=globalThis.localStorage,sessionStorage=globalThis.sessionStorage) { this.storage=storage;this.sessions=sessionStorage;this.user=null; }
  load(){const raw=this.storage.getItem(DB_KEY);if(!raw){const seed=createDemoSeed();this.save(seed);return seed;}try{const db=JSON.parse(raw);if(db.version!==1||!Array.isArray(db.equipment)||!Array.isArray(db.reports)||!Array.isArray(db.events))throw 0;return db;}catch{throw new Error("Los datos de práctica no se pueden leer. Restablécelos desde la pantalla de acceso.");}}
  save(db){try{this.storage.setItem(DB_KEY,JSON.stringify(db));}catch{throw new Error("El navegador no permitió guardar la práctica. Revisa el almacenamiento o el modo privado.");}}
  async restore(){const role=this.sessions.getItem(SESSION_KEY);this.user=DEMO_USERS[role]??null;return this.user;}
  async loginDemo(role){if(!DEMO_USERS[role])throw new Error("Selecciona un rol válido.");this.load();this.user={...DEMO_USERS[role]};this.sessions.setItem(SESSION_KEY,role);return this.user;}
  async logout(){this.sessions.removeItem(SESSION_KEY);this.user=null;}
  requireUser(){if(!this.user)throw new Error("Ingresa primero para continuar.");}
  requireAdmin(){this.requireUser();if(this.user.role!=="admin")throw new Error("Solo el administrador puede realizar esta acción.");}
  async getData(){this.requireUser();const db=this.load();const reports=this.user.role==="admin"?db.reports:db.reports.filter(r=>r.reporter_id===this.user.id);const visible=new Set(reports.map(r=>r.id));return {equipment:db.equipment.map(pc=>({...pc,active_count:db.reports.filter(r=>r.equipment_id===pc.id&&isActive(r)).length})),reports,events:db.events.filter(e=>visible.has(e.report_id))};}
  async saveEquipment(input,currentId=null){this.requireAdmin();const db=this.load();const fields=validateEquipment(input,db.equipment,currentId);if(currentId){const pc=db.equipment.find(p=>p.id===currentId);if(!pc)throw new Error("No se encontró la computadora.");if(pc.code!==fields.code)throw new Error("El código de un equipo registrado no se puede cambiar.");Object.assign(pc,fields);}else db.equipment.push({id:id(),...fields,created_at:new Date().toISOString()});this.save(db);}
  async createReport(input){this.requireUser();const db=this.load(),fields=validateReport(input,db.equipment),now=new Date().toISOString();const report={id:id(),report_number:Math.max(1000,...db.reports.map(r=>r.report_number))+1,...fields,reporter_id:this.user.id,status:"pending",solution:"",created_at:now,updated_at:now,resolved_at:null};db.reports.push(report);db.events.push({id:id(),report_id:report.id,status:"pending",note:"Reporte recibido.",actor_label:this.user.role==="admin"?"Administrador":"Estudiante",created_at:now});this.save(db);return report;}
  async transitionReport(reportId,next,note,solution,expectedStatus){this.requireAdmin();const db=this.load(),r=db.reports.find(x=>x.id===reportId);if(!r)throw new Error("No se encontró el reporte.");if(r.status!==expectedStatus)throw new Error("El reporte cambió. Actualiza la información y vuelve a abrirlo.");const fields=validateTransition(r,next,note,solution),now=new Date().toISOString();Object.assign(r,{status:fields.status,solution:fields.solution,updated_at:now,resolved_at:next==="resolved"?now:null});db.events.push({id:id(),report_id:r.id,status:next,note:fields.note,actor_label:"Administrador",created_at:now});this.save(db);return r;}
  reset(){this.save(createDemoSeed());}
}
