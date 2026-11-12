from django.contrib import admin

from .models import Pendiente


@admin.register(Pendiente)
class PendienteAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'fecha_inicio', 'fecha_fin', 'estatus', 'prioridad', 'fecha_cierre')
    list_filter = ('estatus', 'prioridad')
    search_fields = ('nombre',)
