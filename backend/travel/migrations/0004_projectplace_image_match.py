from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('travel', '0003_projectplace_image_source_url')]
    operations = [migrations.AddField(
        model_name='projectplace', name='image_match',
        field=models.CharField(default='none', max_length=12),
    )]
