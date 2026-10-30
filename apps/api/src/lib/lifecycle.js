/** Drain responses and jobs before closing storage. The caller owns the process exit. */
export async function drainServer(server, store, jobs = [], timeoutMs = 9000) {
  let timer;
  try {
    await Promise.race([
      (async()=>{await new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeIdleConnections?.();});await Promise.allSettled(jobs);await store.close();})(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Graceful shutdown deadline exceeded')),timeoutMs);timer.unref?.();}),
    ]);
  } catch(e) {server.closeAllConnections?.();throw e;}
  finally {clearTimeout(timer);}
}
