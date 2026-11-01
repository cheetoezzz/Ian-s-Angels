import fs from 'node:fs';
const names = ['house-door-fill','clipboard2-data-fill','trophy-fill','calendar-week-fill','people-fill','person-plus-fill','download','clock','arrow-right','grid','check-lg','plus-lg','list','check-circle-fill','x-circle-fill','info-circle-fill','exclamation-triangle-fill','link-45deg'];
const symbols = names.map(name=>{
  const svg=fs.readFileSync(`node_modules/bootstrap-icons/icons/${name}.svg`,'utf8');
  return `<symbol id="${name}" viewBox="0 0 16 16">${svg.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'')}</symbol>`;
});
fs.mkdirSync('public/icons',{recursive:true});
fs.writeFileSync('public/icons/ui.svg',`<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('\n')}</svg>`);
fs.copyFileSync('node_modules/bootstrap-icons/LICENSE','public/icons/bootstrap-icons-LICENSE.txt');
