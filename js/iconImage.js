// ย่อรูปที่ผู้ใช้เลือกเป็น 96×96 WebP (ครอปกลางเป็นจัตุรัส) แล้วคืนเป็น data URL ที่ไม่เกิน 15 KB
// ใช้ canvas จึงทำงานเฉพาะในเบราว์เซอร์ (ส่วนตรวจขนาด/ลดคุณภาพทดสอบอยู่ที่ icons.js)
// error.message: 'not-image' | 'no-webp' | 'too-big'
import { IMAGE_SIZE, MAX_IMAGE_BYTES, encodeWithin } from './icons.js';

export async function fileToIconDataUrl(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('not-image');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('not-image'); }
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const side = Math.min(bmp.width, bmp.height);
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
  bmp.close?.();
  const encode = async (q) => canvas.toDataURL('image/webp', q);
  if (!(await encode(0.9)).startsWith('data:image/webp')) throw new Error('no-webp'); // เบราว์เซอร์เก่าจะคืน PNG
  const url = await encodeWithin(encode, MAX_IMAGE_BYTES);
  if (!url) throw new Error('too-big');
  return url;
}
