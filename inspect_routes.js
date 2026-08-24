const express = require('express');
const screenerRoutes = require('./src/routes/screenerRoutes');
const stack = screenerRoutes.stack || [];
console.log('Screener route stack count:', stack.length);
stack.forEach((layer, idx) => {
  const route = layer.route;
  if (route) {
    const methods = Object.keys(route.methods).join(', ');
    console.log(`${idx}: ${methods} ${route.path}`);
    route.stack.forEach((m, mi) => {
      console.log(`   middleware[${mi}]: ${m.name || '<anonymous>'}`);
    });
  } else {
    console.log(`${idx}: ${layer.name || '<anonymous>'} ${layer.regexp}`);
  }
});
