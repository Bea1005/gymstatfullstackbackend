const screenerRoutes = require('./src/routes/screenerRoutes');
console.log('resolve', require.resolve('./src/routes/screenerRoutes'));
console.log('stack len', screenerRoutes.stack.length);
for (const [idx, layer] of screenerRoutes.stack.entries()) {
  if (layer.route) {
    console.log(`${idx}: ${Object.keys(layer.route.methods).join(', ')} ${layer.route.path}`);
    layer.route.stack.forEach((mw, mi) => {
      console.log(`  mw[${mi}]: ${mw.name || '<anon>'}`);
      console.log(`    handler: ${mw.handle ? mw.handle.toString().slice(0,200).replace(/\n/g,' ') : mw.toString().slice(0,200).replace(/\n/g,' ')}`);
      console.log(`    props: ${JSON.stringify(Object.keys(mw))}`);
    });
  } else {
    console.log(`${idx}: no route ${layer.name}`);
  }
}
