import sharp from 'sharp';

export const MAX_UPLOAD = 8 * 1024 * 1024;

// validate + downscale to max 1600px jpeg before it goes anywhere near the API
export async function prepPhoto(buf) {
  try {
    const out = await sharp(buf, { failOn: 'error' })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();
    return out;
  } catch {
    const err = new Error('could not read that image. try a jpg or png');
    err.status = 400;
    throw err;
  }
}

export const b64 = (buf) => buf.toString('base64');
