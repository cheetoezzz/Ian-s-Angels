import fs from 'node:fs';
import sharp from 'sharp';
// Use the supplied transparent KAMPO emblem with padding for home-screen icons.
fs.mkdirSync('public/icons', {recursive:true});
for (const size of [192,512]) {
  const emblem = await sharp('public/images/kampo-emblem-white.svg')
    .resize(Math.round(size * .7), Math.round(size * .7), {fit:'inside'}).png().toBuffer();
  await sharp({create:{width:size,height:size,channels:4,background:'#82070d'}})
    .composite([{input:emblem,gravity:'centre'}]).png().toFile(`public/icons/icon-${size}.png`);
}
