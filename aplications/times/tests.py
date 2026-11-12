import json
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from .models import Pendiente


class PendientesApiTests(TestCase):
    def post(self, data):
        return self.client.post('/api/pendientes/', json.dumps(data), content_type='application/json')

    def patch(self, pk, data):
        return self.client.patch(f'/api/pendientes/{pk}/', json.dumps(data), content_type='application/json')

    def test_dashboard_carga(self):
        r = self.client.get('/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('csrftoken', r.cookies)

    def test_crear_y_listar(self):
        fin = (timezone.localdate() + timedelta(days=5)).isoformat()
        r = self.post({'nombre': '  Reporte  ', 'fecha_fin': fin})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['nombre'], 'Reporte')
        self.assertEqual(r.json()['estatus'], 'proceso')
        self.assertEqual(len(self.client.get('/api/pendientes/').json()['pendientes']), 1)

    def test_validaciones(self):
        self.assertEqual(self.post({'nombre': '', 'fecha_fin': '2026-12-01'}).status_code, 400)
        self.assertEqual(self.post({'nombre': 'X', 'fecha_fin': 'mal'}).status_code, 400)
        r = self.post({'nombre': 'X', 'fecha_inicio': '2026-12-10', 'fecha_fin': '2026-12-01'})
        self.assertEqual(r.status_code, 400)

    def test_cambio_estatus_registra_cierre(self):
        p = Pendiente.objects.create(nombre='A', fecha_fin=timezone.localdate())
        r = self.patch(p.id, {'estatus': 'terminado'})
        self.assertEqual(r.json()['fecha_cierre'], timezone.localdate().isoformat())
        r = self.patch(p.id, {'estatus': 'proceso'})
        self.assertIsNone(r.json()['fecha_cierre'])
        self.assertEqual(self.patch(p.id, {'estatus': 'otro'}).status_code, 400)

    def test_eliminar(self):
        p = Pendiente.objects.create(nombre='A', fecha_fin=timezone.localdate())
        self.assertEqual(self.client.delete(f'/api/pendientes/{p.id}/').status_code, 200)
        self.assertFalse(Pendiente.objects.exists())

    def test_prioridad(self):
        fin = timezone.localdate().isoformat()
        r = self.post({'nombre': 'P', 'fecha_fin': fin})
        self.assertEqual(r.json()['prioridad'], 'media')
        r = self.post({'nombre': 'P', 'fecha_fin': fin, 'prioridad': 'alta'})
        self.assertEqual(r.json()['prioridad'], 'alta')
        self.assertEqual(self.patch(r.json()['id'], {'prioridad': 'urgente'}).status_code, 400)
