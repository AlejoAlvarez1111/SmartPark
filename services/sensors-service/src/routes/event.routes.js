const express = require('express');

function createEventRoutes(c) {
  const router = express.Router();
  router.post('/events/entry', c.entry);
  router.post('/events/exit', c.exit);
  router.get('/events', c.list);
  return router;
}

module.exports = { createEventRoutes };
