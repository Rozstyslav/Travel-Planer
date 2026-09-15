import django.db.models.deletion
from django.db import migrations, models


def archive_places(apps, schema_editor):
    Project = apps.get_model('travel', 'TravelProject')
    Place = apps.get_model('travel', 'ProjectPlace')
    alias = schema_editor.connection.alias
    for project in Project.objects.using(alias).iterator():
        rows = []
        for place in Place.objects.using(alias).filter(project_id=project.pk).values():
            rows.append(
                {key: value.isoformat() if hasattr(value, 'isoformat') else value for key, value in place.items()})
        Project.objects.using(alias).filter(pk=project.pk).update(archived_places=rows)


def restore_places(apps, schema_editor):
    Project = apps.get_model('travel', 'TravelProject')
    Place = apps.get_model('travel', 'ProjectPlace')
    alias = schema_editor.connection.alias
    for project in Project.objects.using(alias).iterator():
        for row in project.archived_places:
            place = Place.objects.using(alias).create(**row)
            Place.objects.using(alias).filter(pk=place.pk).update(created_at=row['created_at'],
                                                                  updated_at=row['updated_at'])


class Migration(migrations.Migration):
    dependencies = [('travel', '0001_initial')]
    operations = [
        migrations.AddField(model_name='travelproject', name='archived_places',
                            field=models.JSONField(default=list, editable=False)),
        migrations.RunPython(archive_places, restore_places),
        migrations.DeleteModel(name='ProjectPlace'),
        migrations.CreateModel(
            name='ProjectPlace',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('place_id', models.CharField(max_length=512)),
                ('source_id', models.CharField(max_length=512)),
                ('name', models.CharField(max_length=500)),
                ('address', models.TextField(blank=True)),
                ('country_code', models.CharField(blank=True, max_length=2)),
                ('city', models.CharField(blank=True, max_length=255)),
                ('latitude', models.FloatField()), ('longitude', models.FloatField()),
                ('categories', models.JSONField(default=list)),
                ('description', models.TextField(blank=True)),
                ('image_url', models.URLField(blank=True, max_length=2000)),
                ('wikipedia_url', models.URLField(blank=True, max_length=2000)),
                ('wikipedia_title', models.CharField(blank=True, max_length=500)),
                ('wikipedia_match', models.CharField(default='none', max_length=12)),
                ('notes', models.TextField(blank=True)), ('visited', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='places',
                                              to='travel.travelproject')),
            ],
            options={'ordering': ['created_at'], 'constraints': [
                models.UniqueConstraint(fields=('project', 'place_id'), name='unique_geo_place_per_project'),
                models.UniqueConstraint(fields=('project', 'source_id'), name='unique_source_place_per_project'),
            ]},
        ),
    ]
