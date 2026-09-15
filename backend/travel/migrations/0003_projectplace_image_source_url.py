from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('travel', '0002_geographic_places')]
    operations = [migrations.AddField(
        model_name='projectplace', name='image_source_url',
        field=models.URLField(blank=True, max_length=2000),
    )]
