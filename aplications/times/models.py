from django.db import models
from django.utils import timezone


class Pendiente(models.Model):
    class Estatus(models.TextChoices):
        EN_PROCESO = 'proceso', 'En proceso'
        TERMINADO = 'terminado', 'Terminado'
        CANCELADO = 'cancelado', 'Cancelado'

    class Prioridad(models.TextChoices):
        ALTA = 'alta', 'Alta'
        MEDIA = 'media', 'Media'
        BAJA = 'baja', 'Baja'

    nombre = models.CharField(max_length=200)
    fecha_inicio = models.DateField(default=timezone.localdate)
    fecha_fin = models.DateField()
    estatus = models.CharField(max_length=12, choices=Estatus.choices, default=Estatus.EN_PROCESO)
    prioridad = models.CharField(max_length=6, choices=Prioridad.choices, default=Prioridad.MEDIA)
    fecha_cierre = models.DateField(null=True, blank=True)
    creado = models.DateTimeField(auto_now_add=True)
    actualizado = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['fecha_fin', 'id']
        indexes = [
            models.Index(fields=['estatus', 'fecha_fin'], name='pend_estatus_fin'),
            models.Index(fields=['fecha_fin'], name='pend_fin'),
        ]
        verbose_name = 'pendiente'
        verbose_name_plural = 'pendientes'

    def __str__(self):
        return self.nombre

    def save(self, *args, **kwargs):
        # Registra automáticamente el día en que se cerró (terminado / cancelado)
        if self.estatus == self.Estatus.EN_PROCESO:
            self.fecha_cierre = None
        elif self.fecha_cierre is None:
            self.fecha_cierre = timezone.localdate()
        super().save(*args, **kwargs)

    def to_dict(self):
        return {
            'id': self.id,
            'nombre': self.nombre,
            'fecha_inicio': self.fecha_inicio.isoformat(),
            'fecha_fin': self.fecha_fin.isoformat(),
            'estatus': self.estatus,
            'prioridad': self.prioridad,
            'fecha_cierre': self.fecha_cierre.isoformat() if self.fecha_cierre else None,
        }
