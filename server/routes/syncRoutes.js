const router = require('express').Router();
const c = require('../controllers/syncController');

router.post('/', c.sync);

module.exports = router;