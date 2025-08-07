// Test admin routes loading
const express = require('express');

try {
  const adminRoutes = require('../routes/admin');
  console.log('✅ Admin routes loaded successfully');
  console.log('Admin routes type:', typeof adminRoutes);
  
  // Check if it's a router
  if (adminRoutes && adminRoutes.stack) {
    console.log(`Found ${adminRoutes.stack.length} routes in admin router`);
    adminRoutes.stack.forEach((layer, index) => {
      const route = layer.route;
      if (route) {
        const methods = Object.keys(route.methods).join(', ').toUpperCase();
        console.log(`  ${index + 1}. ${methods} ${route.path}`);
      }
    });
  }
} catch (error) {
  console.error('❌ Error loading admin routes:', error.message);
  console.error('Stack:', error.stack);
}