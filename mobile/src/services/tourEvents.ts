const listeners=new Set<()=>void>();
export const startSystemTour=()=>listeners.forEach(listener=>listener());
export const subscribeSystemTour=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
