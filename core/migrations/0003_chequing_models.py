from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    replaces = [
        ("core", "0003_chequingtransaction"),
        ("core", "0004_chequingtransaction_is_hidden"),
        ("core", "0005_chequingaccount"),
    ]

    dependencies = [
        ("core", "0002_add_card_label_to_creditcardtransaction"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="ChequingTransaction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("account_label", models.CharField(max_length=128)),
                ("transaction_date", models.DateField()),
                ("transaction_code", models.CharField(blank=True, max_length=64, null=True)),
                ("description", models.CharField(blank=True, max_length=255, null=True)),
                ("category", models.CharField(default="Other", max_length=64)),
                ("amount", models.DecimalField(decimal_places=6, max_digits=20)),
                ("balance", models.DecimalField(blank=True, decimal_places=6, max_digits=20, null=True)),
                ("currency", models.CharField(default="CAD", max_length=8)),
                ("is_hidden", models.BooleanField(default=False)),
                ("source_filename", models.CharField(blank=True, max_length=255, null=True)),
                ("imported_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chequing_transactions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(fields=["transaction_date", "id"], name="idx_chequing_tx_date"),
                    models.Index(fields=["category", "transaction_date"], name="idx_chequing_category_date"),
                ],
            },
        ),
        migrations.CreateModel(
            name="ChequingAccount",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("label", models.CharField(max_length=128)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chequing_accounts",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("user", "label"), name="chequing_accounts_user_label_unique")
                ],
            },
        ),
    ]
