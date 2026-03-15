from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_chequing_models"),
    ]

    operations = [
        migrations.AddField(
            model_name="chequingaccount",
            name="provider",
            field=models.CharField(default="WealthSimple", max_length=64),
        ),
    ]
