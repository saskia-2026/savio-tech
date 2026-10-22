// Reglas compartidas: se usan en la interfaz, en la demostración y en las pruebas.
export const STATUSES = Object.freeze({pending:"Pendiente",in_progress:"En proceso",resolved:"Resuelto"});
export const CATEGORIES = Object.freeze(["Software", "Encendido", "Pantalla", "Teclado y mouse", "Conectividad", "Rendimiento", "Otro"]);
export const NEXT_STATUS = Object.freeze({pending:"in_progress",in_progress:"resolved"});
export const isActive = report => report.status !== "resolved";
export const normalizeCode = value => String(value ?? "").trim().toUpperCase();
export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

export function validateEquipment(input, equipment=[], currentId=null) {
  const code=normalizeCode(input.code), name=String(input.name??"").trim(), location=String(input.location??"").trim(), specs=String(input.specs??"").trim();
  if (!/^LAB-\d{2,3}$/.test(code)) throw new Error("Escribe un código como LAB-08 (dos o tres números).");
  if (equipment.some(item=>item.id!==currentId && normalizeCode(item.code)===code)) throw new Error("Ese código ya está registrado. Cada computadora debe tener un código único.");
  if (name.length<3 || name.length>80) throw new Error("El nombre debe tener entre 3 y 80 caracteres.");
  if (location.length<3 || location.length>100) throw new Error("La ubicación debe tener entre 3 y 100 caracteres.");
  if (specs.length>300) throw new Error("Las características deben tener hasta 300 caracteres.");
  return {code,name,location,specs,enabled:input.enabled!==false};
}

export function validateReport(input, equipment=[]) {
  const title=String(input.title??"").trim(), description=String(input.description??"").trim();
  if (!equipment.some(item=>item.id===input.equipment_id && item.enabled)) throw new Error("Selecciona una computadora disponible en el registro.");
  if (!CATEGORIES.includes(input.category)) throw new Error("Selecciona el tipo de falla.");
  if (title.length<5 || title.length>100) throw new Error("El título debe tener entre 5 y 100 caracteres.");
  if (description.length<10 || description.length>1000) throw new Error("Describe lo ocurrido con entre 10 y 1000 caracteres.");
  return {equipment_id:input.equipment_id,category:input.category,title,description};
}

export function validateTransition(report, next, note, solution="") {
  if (NEXT_STATUS[report.status]!==next) throw new Error("El reporte debe avanzar de Pendiente a En proceso y después a Resuelto.");
  note=String(note??"").trim(); solution=String(solution??"").trim();
  if (note.length<5 || note.length>1000) throw new Error("Escribe una observación de entre 5 y 1000 caracteres.");
  if (next==="resolved" && (solution.length<5 || solution.length>1000)) throw new Error("Para resolver el reporte, registra una solución de entre 5 y 1000 caracteres.");
  return {status:next,note,solution:next==="resolved"?solution:""};
}

export function summarize(equipment, reports) {
  return {
    equipment:equipment.filter(item=>item.enabled).length,
    pending:reports.filter(item=>item.status==="pending").length,
    in_progress:reports.filter(item=>item.status==="in_progress").length,
    resolved:reports.filter(item=>item.status==="resolved").length,
    clear:equipment.filter(item=>item.enabled && Number(item.active_count)===0).length,
    affected:equipment.filter(item=>item.enabled && Number(item.active_count)>0).length
  };
}

export function filterReports(reports,equipment,{query="",status="",equipmentId="",from="",to=""}={}) {
  const term=query.trim().toLocaleLowerCase("es");
  return reports.filter(report=>{
    const pc=equipment.find(item=>item.id===report.equipment_id);
    const text=`${pc?.code??""} ${report.title} ${report.description} ${report.solution??""} ST-${report.report_number} ${report.category}`.toLocaleLowerCase("es");
    const date=report.created_at.slice(0,10);
    return (!term||text.includes(term)) && (!status||report.status===status) && (!equipmentId||report.equipment_id===equipmentId) && (!from||date>=from) && (!to||date<=to);
  }).sort((a,b)=>b.created_at.localeCompare(a.created_at));
}

export function csvCell(value) {
  let text=String(value??"");
  if (/^[=+\-@\t\r]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
