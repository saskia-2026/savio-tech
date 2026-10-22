// Cliente REST sin dependencias externas. Supabase Auth autentica; PostgreSQL aplica RLS.
import {validateEquipment,validateReport,validateTransition} from "./domain.mjs";
const SESSION_KEY="savio-tech-auth-v1";

export function validateConfig(config) {
  const url=String(config.SUPABASE_URL??"").replace(/\/+$/,"");
  const key=String(config.SUPABASE_PUBLISHABLE_KEY??"").trim();
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))throw new Error("Completa SUPABASE_URL en config.js con la URL HTTPS de tu proyecto Supabase.");
  let legacyRole="";
  if(key.startsWith("eyJ")){try{const part=key.split(".")[1].replaceAll("-","+").replaceAll("_","/");legacyRole=JSON.parse(atob(part)).role;}catch{throw new Error("La clave de Supabase no es válida.");}}
  if(key.startsWith("sb_secret_")||legacyRole==="service_role")throw new Error("Retira la clave secreta de config.js. Solo se admite una clave publicable o anon.");
  if(!key.startsWith("sb_publishable_")&&legacyRole!=="anon")throw new Error("Completa SUPABASE_PUBLISHABLE_KEY con una clave publicable (sb_publishable_...).");
  return {url,key};
}

export function apiErrorMessage(payload,status) {
  const code=payload?.code;
  if(code==="23505")return "Ese código ya existe. Registra una computadora con un código diferente.";
  if(code==="42501"||status===403)return "Tu cuenta no tiene permiso para realizar esta acción.";
  if(status===401||payload?.error_code==="invalid_credentials")return "No se pudo validar el acceso. Revisa el correo y la contraseña o vuelve a iniciar sesión.";
  if(status===429)return "Hay demasiados intentos. Espera un momento y vuelve a intentarlo.";
  if(status===404||code==="42P01"||code==="PGRST202"||code==="PGRST205")return "Falta instalar la base de datos. Ejecuta database/setup.sql en el proyecto Supabase correcto.";
  if(code==="P0001"||code==="23514")return payload.message||"Revisa los datos del formulario.";
  return "No se pudo completar la operación. Revisa tu conexión y la configuración de Supabase.";
}

export class SupabaseService {
  constructor(config,storage=globalThis.sessionStorage,fetcher=globalThis.fetch.bind(globalThis)) {Object.assign(this,validateConfig(config));this.storage=storage;this.fetcher=fetcher;this.session=null;this.user=null;this.refreshing=null;}
  remember(session){this.session={...session,expires_at:session.expires_at??Math.floor(Date.now()/1000)+(session.expires_in??3600)};this.storage.setItem(SESSION_KEY,JSON.stringify(this.session));}
  async call(path,{method="GET",body,auth=true,prefer}={}) {
    if(auth)await this.ensureSession();
    const headers={apikey:this.key,"Content-Type":"application/json"};
    if(auth&&this.session?.access_token)headers.Authorization=`Bearer ${this.session.access_token}`;
    if(prefer)headers.Prefer=prefer;
    let response;
    try{response=await this.fetcher(`${this.url}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}catch{throw new Error("No se pudo conectar con Supabase. Revisa internet e intenta de nuevo.");}
    const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{throw new Error("El servidor devolvió una respuesta inesperada.");}
    if(!response.ok){if(response.status===401&&auth){this.session=null;this.user=null;this.storage.removeItem(SESSION_KEY);}throw new Error(apiErrorMessage(data,response.status));}
    return data;
  }
  async ensureSession(){
    if(!this.session)throw new Error("Tu sesión terminó. Vuelve a ingresar.");
    if(this.session.expires_at>Math.floor(Date.now()/1000)+60)return;
    if(!this.refreshing)this.refreshing=(async()=>{try{const data=await this.call("/auth/v1/token?grant_type=refresh_token",{method:"POST",body:{refresh_token:this.session.refresh_token},auth:false});this.remember(data);}catch(error){this.session=null;this.user=null;this.storage.removeItem(SESSION_KEY);throw error;}finally{this.refreshing=null;}})();
    await this.refreshing;
  }
  async profile(){const data=await this.call("/rest/v1/tech_profiles?select=id,role,display_name&id=eq."+encodeURIComponent(this.session.user.id));if(!data?.[0])throw new Error("Tu cuenta no tiene perfil. Pide al docente que revise la instalación de Supabase.");this.user=data[0];return this.user;}
  async login(email,password){const data=await this.call("/auth/v1/token?grant_type=password",{method:"POST",body:{email:email.trim(),password},auth:false});this.remember(data);return this.profile();}
  async restore(){const raw=this.storage.getItem(SESSION_KEY);if(!raw)return null;try{const session=JSON.parse(raw);if(!session.access_token||!session.refresh_token||!session.user?.id)throw 0;this.session=session;}catch{this.storage.removeItem(SESSION_KEY);return null;}await this.ensureSession();return this.profile();}
  async logout(){try{if(this.session)await this.call("/auth/v1/logout?scope=local",{method:"POST"});}finally{this.session=null;this.user=null;this.storage.removeItem(SESSION_KEY);}}
  async allRows(table,order){const result=[];let offset=0;for(;;){const page=await this.call(`/rest/v1/${table}?select=*&order=${order}&limit=500&offset=${offset}`);if(!Array.isArray(page))throw new Error("La consulta devolvió datos inesperados.");result.push(...page);if(page.length<500)return result;offset+=500;if(offset>=20000)throw new Error("Se alcanzó el límite de consulta de esta versión escolar. Pide al docente ampliar la paginación.");}}
  async getData(){const [equipment,reports,events]=await Promise.all([this.call("/rest/v1/rpc/tech_equipment_overview",{method:"POST",body:{}}),this.allRows("tech_reports","created_at.desc,id.desc"),this.allRows("tech_report_events","created_at.asc,id.asc")]);if(equipment.length>=1000)throw new Error("Se alcanzó el límite de equipos de esta versión escolar.");return {equipment,reports,events};}
  async saveEquipment(input,currentId=null){if(this.user?.role!=="admin")throw new Error("Solo el administrador puede editar equipos.");const data=await this.getData();const fields=validateEquipment(input,data.equipment,currentId);let rows;if(currentId){const current=data.equipment.find(x=>x.id===currentId);if(!current)throw new Error("No se encontró la computadora.");if(current.code!==fields.code)throw new Error("El código de un equipo registrado no se puede cambiar.");const {code,...updates}=fields;rows=await this.call("/rest/v1/tech_equipment?id=eq."+encodeURIComponent(currentId),{method:"PATCH",body:updates,prefer:"return=representation"});}else rows=await this.call("/rest/v1/tech_equipment",{method:"POST",body:fields,prefer:"return=representation"});if(!rows?.[0])throw new Error("No se confirmó el guardado del equipo. Actualiza la lista antes de reintentar.");}
  async createReport(input){const data=await this.getData(),fields=validateReport(input,data.equipment);const rows=await this.call("/rest/v1/tech_reports",{method:"POST",body:{...fields,reporter_id:this.user.id},prefer:"return=representation"});if(!rows?.[0])throw new Error("No se confirmó el guardado del reporte. Actualiza la lista antes de volver a enviarlo.");return rows[0];}
  async transitionReport(reportId,next,note,solution,expectedStatus){if(this.user?.role!=="admin")throw new Error("Solo el administrador puede cambiar estados.");validateTransition({status:expectedStatus},next,note,solution);return this.call("/rest/v1/rpc/tech_transition_report",{method:"POST",body:{p_report_id:reportId,p_expected_status:expectedStatus,p_next_status:next,p_note:note.trim(),p_solution:solution.trim()}});}
}
