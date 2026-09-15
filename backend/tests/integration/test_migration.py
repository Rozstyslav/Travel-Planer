from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class GeographyMigrationTests(TransactionTestCase):
    def test_existing_places_are_archived_and_projects_preserved(self):
        executor = MigrationExecutor(connection)
        old = [('travel', '0001_initial')]
        new = [('travel', '0002_geographic_places')]
        executor.migrate(old)
        try:
            apps = executor.loader.project_state(old).apps
            project = apps.get_model('travel', 'TravelProject').objects.create(name='Keep this trip')
            place = apps.get_model('travel', 'ProjectPlace').objects.create(project_id=project.pk, external_id=27992,
                title='Old artwork', artist_display='Artist', image_id='image', notes='Keep my note', visited=True)
            executor = MigrationExecutor(connection)
            executor.migrate(new)
            apps = executor.loader.project_state(new).apps
            migrated = apps.get_model('travel', 'TravelProject').objects.get(pk=project.pk)
            self.assertEqual(migrated.name, 'Keep this trip')
            self.assertEqual(migrated.archived_places[0]['id'], place.pk)
            self.assertEqual(migrated.archived_places[0]['notes'], 'Keep my note')
            self.assertTrue(migrated.archived_places[0]['visited'])
            self.assertEqual(apps.get_model('travel', 'ProjectPlace').objects.count(), 0)
            executor = MigrationExecutor(connection)
            executor.migrate(old)
            apps = executor.loader.project_state(old).apps
            self.assertEqual(apps.get_model('travel', 'ProjectPlace').objects.get(pk=place.pk).notes, 'Keep my note')
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
