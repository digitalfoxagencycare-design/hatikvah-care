/** Opt-in Express integration transport. Exercises middleware and byte bodies without opening sockets. */
import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
const apps=new Map();let nextPort=19000,installed=false;
export function registerApp(app) {
  if(!installed){
    installed=true;const native=globalThis.fetch;
    globalThis.fetch=async(input,init={})=>{
      const url=new URL(typeof input==='string'?input:input.url||String(input));
      const app=apps.get(url.origin);if(!app)return native(input,init);
      return request(app,url,init);
    };
  }
  const base=`http://127.0.0.1:${nextPort++}`;apps.set(base,app);return{base,close:()=>apps.delete(base)};
}
function request(app,url,init){return new Promise((resolve,reject)=>{
  const socket=new Duplex({read(){},write(chunk,enc,cb){cb();}});
  Object.defineProperty(socket,'remoteAddress',{value:'127.0.0.1'});
  const req=new IncomingMessage(socket);req.method=init.method||'GET';req.url=url.pathname+url.search;
  req.httpVersion='1.1';req.httpVersionMajor=1;req.httpVersionMinor=1;
  req.complete=true; // The synthetic HTTP message is fully received; body-stream end must not destroy its socket.
  const headers=new Headers(init.headers);headers.set('host',url.host);
  const body=init.body===undefined?null:Buffer.isBuffer(init.body)?init.body:Buffer.from(String(init.body));
  if(body)headers.set('content-length',String(body.length));
  req.headers=Object.fromEntries(headers.entries());req.rawHeaders=[...headers].flat();
  const res=new ServerResponse(req);res.assignSocket(socket);
  const chunks=[],write=res.write.bind(res),end=res.end.bind(res);
  res.write=function(chunk,encoding,callback){if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));return write(chunk,encoding,callback);};
  res.end=function(chunk,encoding,callback){if(chunk)chunks.push(Buffer.from(chunk,typeof encoding==='string'?encoding:undefined));return end(chunk,encoding,callback);};
  res.on('error',reject);req.on('error',reject);
  res.on('finish',()=>{
    const output=new Headers();for(const[k,v]of Object.entries(res.getHeaders()))for(const x of Array.isArray(v)?v:[v])output.append(k,String(x));
    resolve(new Response([204,205,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers:output}));
    socket.destroy();
  });
  if(body)req.push(body);req.push(null);app(req,res);
});}
