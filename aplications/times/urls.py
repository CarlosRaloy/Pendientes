from django.urls import path

from . import views

app_name = 'times'

urlpatterns = [
    path('', views.dashboard, name='dashboard'),
    path('api/pendientes/', views.pendientes, name='pendientes'),
    path('api/pendientes/<int:pk>/', views.pendiente_detalle, name='pendiente_detalle'),
]
