const router = require('express').Router();
const c = require('../controllers/simulationController');

router.post('/run', c.run);                 // primary (spec)
router.post('/', c.run);                    // frontend compatibility
router.get('/', c.list);
router.get('/latest', c.latest);            // frontend compatibility (must be before /:id)
router.get('/:id', c.getOne);
router.post('/:id/optimize', c.optimize);   // frontend compatibility
router.post('/:id/plan', c.generatePlan);   // frontend compatibility

module.exports = router;