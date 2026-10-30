/** Buffer a mutating controller response until its database unit of work commits. */
export function atomicWrap(store, fn, { commitErrors = () => false, readSnapshot = false } = {}) {
  return async(req,res,next)=>{
    if (!readSnapshot && ['GET','HEAD'].includes(req.method)) return Promise.resolve(fn(req,res,next)).catch(next);
    const originals={json:res.json,send:res.send,end:res.end};let pending=null;
    for(const method of Object.keys(originals))res[method]=(...args)=>{pending={method,args};return res;};
    const rejected=Symbol('http rollback');
    try {
      await store.atomic(async()=>{await fn(req,res,next);if(res.statusCode>=400 && !commitErrors(req))throw rejected;});
    } catch(e) {if(e!==rejected){for(const[k,v]of Object.entries(originals))res[k]=v;return next(e);}}
    for(const[k,v]of Object.entries(originals))res[k]=v;
    if(pending)return originals[pending.method].apply(res,pending.args);
  };
}
