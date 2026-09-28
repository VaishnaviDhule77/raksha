const router = require('express').Router();
const c = require('../controllers/scenarioController');

router.get('/', c.list);
router.post('/', c.create);
router.get('/:id', c.getOne);

module.exports = router;