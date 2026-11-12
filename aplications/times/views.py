import json
from datetime import date

from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from .models import Pendiente

ESTATUS_VALIDOS = {c.value for c in Pendiente.Estatus}
PRIORIDADES_VALIDAS = {c.value for c in Pendiente.Prioridad}


@ensure_csrf_cookie
def dashboard(request):
    return render(request, 'dashboard.html')


def _error(msg, status=400):
    return JsonResponse({'error': msg}, status=status)


def _parse_fecha(valor, campo):
    try:
        return date.fromisoformat(valor)
    except (TypeError, ValueError):
        raise ValueError(f'La {campo} no es válida.')


def _aplicar(p, data, nuevo=False):
    """Valida y aplica los campos enviados al pendiente."""
    if 'nombre' in data or nuevo:
        nombre = (data.get('nombre') or '').strip()
        if not nombre:
            raise ValueError('Escribe el nombre del pendiente.')
        p.nombre = nombre[:200]
    if 'fecha_inicio' in data:
        p.fecha_inicio = _parse_fecha(data['fecha_inicio'], 'fecha de inicio')
    if 'fecha_fin' in data or nuevo:
        p.fecha_fin = _parse_fecha(data.get('fecha_fin'), 'fecha de fin')
    if 'estatus' in data:
        if data['estatus'] not in ESTATUS_VALIDOS:
            raise ValueError('Estatus no válido.')
        p.estatus = data['estatus']
    if 'prioridad' in data:
        if data['prioridad'] not in PRIORIDADES_VALIDAS:
            raise ValueError('Importancia no válida.')
        p.prioridad = data['prioridad']
    if p.fecha_fin < p.fecha_inicio:
        raise ValueError('La fecha de fin no puede ser antes de la fecha de inicio.')


def _leer_json(request):
    try:
        return json.loads(request.body or b'{}')
    except json.JSONDecodeError:
        raise ValueError('Datos inválidos.')


@require_http_methods(['GET', 'POST'])
def pendientes(request):
    if request.method == 'GET':
        # values_list evita construir un objeto por fila: mucho más rápido con miles de tareas
        campos = ('id', 'nombre', 'fecha_inicio', 'fecha_fin', 'estatus', 'prioridad', 'fecha_cierre')
        filas = Pendiente.objects.order_by('fecha_fin', 'id').values_list(*campos)
        data = [
            {'id': i, 'nombre': n, 'fecha_inicio': ini.isoformat(), 'fecha_fin': fin.isoformat(),
             'estatus': e, 'prioridad': pr, 'fecha_cierre': c.isoformat() if c else None}
            for i, n, ini, fin, e, pr, c in filas
        ]
        return JsonResponse({'pendientes': data})
    try:
        data = _leer_json(request)
        p = Pendiente()
        _aplicar(p, data, nuevo=True)
    except ValueError as e:
        return _error(str(e))
    p.save()
    return JsonResponse(p.to_dict(), status=201)


@require_http_methods(['PATCH', 'DELETE'])
def pendiente_detalle(request, pk):
    p = get_object_or_404(Pendiente, pk=pk)
    if request.method == 'DELETE':
        p.delete()
        return JsonResponse({'ok': True})
    try:
        _aplicar(p, _leer_json(request))
    except ValueError as e:
        return _error(str(e))
    p.save()
    return JsonResponse(p.to_dict())
