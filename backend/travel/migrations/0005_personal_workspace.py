from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('travel', '0004_projectplace_image_match'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='travelproject', name='owner',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                                    related_name='travel_projects', to=settings.AUTH_USER_MODEL),
        ),
        migrations.CreateModel(
            name='SavedPlace',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('place_id', models.CharField(max_length=512)),
                ('source_id', models.CharField(max_length=512)),
                ('details', models.JSONField(default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                            related_name='saved_places', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at', '-id'],
                'constraints': [
                    models.UniqueConstraint(fields=('owner', 'place_id'), name='unique_saved_place_per_user'),
                    models.UniqueConstraint(fields=('owner', 'source_id'), name='unique_saved_source_per_user'),
                ],
            },
        ),
    ]
