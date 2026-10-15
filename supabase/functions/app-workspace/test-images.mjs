// Complete synthetic solid-color PNG; no patient/source image or network fixture.
import {deflateSync} from 'node:zlib';
const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc=b=>{let c=0xffffffff;for(const n of b)c=table[(c^n)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;}
export function testPNG(width=20,height=30,{headerWidth=width,headerHeight=height}={}){const h=Buffer.alloc(13);h.writeUInt32BE(headerWidth);h.writeUInt32BE(headerHeight,4);h[8]=8;h[9]=6;const raw=Buffer.alloc((width*4+1)*height);return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}
