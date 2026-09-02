const express = require('express');
const router = express.Router();
const coadaController = require('../controllers/coadaController');

// Status/poziție pacient în coadă (variantă cu parametri expliciți pentru compatibilitate frontend)
router.get('/status_pacient/:id_pacient/:id_medic/:data', coadaController.statusPacientCoada);

// Status coadă pentru un medic
router.get('/:id/status', coadaController.statusCoadaMedic);

// Adaugă pacient la coadă
router.post('/:id/adauga', coadaController.adaugaLaCoada);

// Status/poziție pacient în coadă
router.get('/:id/pacient/:id_pacient', coadaController.statusPacientCoada);

// Anulează prezența la coadă pentru un pacient
router.post('/:id/anuleaza', coadaController.anuleazaCoada);

// Acceptă un pacient din coadă
router.post('/:id/accepta', coadaController.acceptaPacient);

module.exports = router; 