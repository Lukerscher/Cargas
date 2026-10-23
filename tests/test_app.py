import os
import re
import tempfile
import unittest
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook


os.environ.setdefault("DATABASE_PATH", str(Path(tempfile.gettempdir()) / f"almoxcontrol-tests-{os.getpid()}.sqlite"))

import app as application
from app import Category, ConferenceItem, Invoice, Load, Movement, Product, Supplier, User, db


class AlmoxControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        application.app.config.update(TESTING=True, WTF_CSRF_ENABLED=True)

    def setUp(self):
        with application.app.app_context():
            db.drop_all()
            db.create_all()
            self.admin = User(name="Ana Administradora", email="ana@example.com", role="administrador")
            self.admin.set_password("SenhaSegura123")
            self.checker = User(name="Caio Conferente", email="caio@example.com", role="conferente")
            self.checker.set_password("SenhaSegura123")
            category = Category(name="Eletrônicos")
            supplier = Supplier(name="Fornecedor Alfa", document="12345678000100")
            db.session.add_all([self.admin, self.checker, category, supplier])
            db.session.flush()
            self.product = Product(code="PRD-001", barcode="7891234567890", name="Leitor industrial", unit="un", min_stock=2, category=category, supplier=supplier)
            db.session.add(self.product)
            db.session.flush()
            db.session.add(Movement(product=self.product, kind="entrada", quantity=15, reference="NF 100", responsible=self.admin))
            db.session.commit()
            self.product_id = self.product.id
            self.category_id = category.id
            self.supplier_id = supplier.id
            self.admin_id = self.admin.id
        self.client = application.app.test_client()
        page = self.client.get("/login")
        match = re.search(rb'name="csrf_token" value="([^"]+)"', page.data)
        self.assertIsNotNone(match)
        self.csrf = match.group(1).decode()
        response = self.client.post("/login", data={"csrf_token": self.csrf, "email": "ana@example.com", "password": "SenhaSegura123"})
        self.assertEqual(response.status_code, 302)

    def tearDown(self):
        with application.app.app_context():
            db.session.remove()

    def post_json(self, url, body):
        return self.client.post(url, json=body, headers={"X-CSRFToken": self.csrf})

    def test_products_stock_and_shortage_guard(self):
        response = self.post_json("/api/movements", {"product_id": self.product_id, "kind": "saida", "quantity": 16})
        self.assertEqual(response.status_code, 400)
        response = self.post_json("/api/movements", {"product_id": self.product_id, "kind": "saida", "quantity": 3})
        self.assertEqual(response.status_code, 201)
        products = self.client.get("/api/products").get_json()
        self.assertEqual(products[0]["stock"], 12)
        duplicate = self.post_json("/api/products", {"code": "PRD-002", "barcode": "7891234567890", "name": "Duplicado", "unit": "un"})
        self.assertEqual(duplicate.status_code, 400)

    def test_conference_scans_a_product_once_with_total_quantity(self):
        created = self.post_json("/api/loads", {"reference": "LOAD-001", "supplier": "Fornecedor Alfa"})
        load_id = created.get_json()["id"]
        first = self.post_json(f"/api/loads/{load_id}/scan", {"barcode": "7891234567890", "expected_quantity": 20, "quantity": 18})
        self.assertEqual(first.status_code, 201)
        duplicate = self.post_json(f"/api/loads/{load_id}/scan", {"barcode": "7891234567890", "quantity": 1})
        self.assertEqual(duplicate.status_code, 409)
        detail = self.client.get(f"/api/loads/{load_id}").get_json()
        self.assertEqual(len(detail["items"]), 1)
        self.assertEqual(detail["items"][0]["checked"], 18)
        self.assertEqual(detail["items"][0]["expected"], 20)

    def test_invoice_xml_import_is_idempotent_and_updates_stock(self):
        xml = b'''<NFe><infNFe Id="NFe12345678901234567890123456789012345678901234"><ide><nNF>220</nNF></ide><emit><xNome>Fornecedor XML</xNome></emit><det><prod><cProd>PRD-001</cProd><cEAN>7891234567890</cEAN><xProd>Leitor industrial</xProd><qCom>4.0000</qCom><vUnCom>10.25</vUnCom></prod></det></infNFe></NFe>'''
        response = self.client.post("/api/invoices/import", data={"file": (BytesIO(xml), "nf.xml")}, headers={"X-CSRFToken": self.csrf}, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 201, response.get_json())
        duplicate = self.client.post("/api/invoices/import", data={"file": (BytesIO(xml), "nf.xml")}, headers={"X-CSRFToken": self.csrf}, content_type="multipart/form-data")
        self.assertEqual(duplicate.status_code, 400)
        product = self.client.get("/api/products").get_json()[0]
        self.assertEqual(product["stock"], 19)

    def test_inventory_counts_and_adjusts_stock_when_closed(self):
        created = self.post_json("/api/inventories", {"reference": "INV-001"})
        inventory_id = created.get_json()["id"]
        detail = self.client.get(f"/api/inventories/{inventory_id}").get_json()
        item = detail["items"][0]
        counted = self.client.put(f"/api/inventories/{inventory_id}/items/{item['id']}", json={"counted": 12}, headers={"X-CSRFToken": self.csrf})
        self.assertEqual(counted.status_code, 200)
        closed = self.post_json(f"/api/inventories/{inventory_id}/close", {})
        self.assertEqual(closed.status_code, 200)
        product = self.client.get("/api/products").get_json()[0]
        self.assertEqual(product["stock"], 12)

    def test_reports_filter_and_export_csv_excel(self):
        self.post_json("/api/movements", {"product_id": self.product_id, "kind": "entrada", "quantity": 5, "reference": "COMPRA"})
        filters = f"?product_id={self.product_id}&category_id={self.category_id}&supplier_id={self.supplier_id}&responsible_id={self.admin_id}"
        report = self.client.get(f"/api/reports/movements{filters}")
        self.assertEqual(report.status_code, 200)
        self.assertEqual(len(report.get_json()), 2)
        csv_response = self.client.get(f"/api/reports/export/csv{filters}")
        self.assertEqual(csv_response.status_code, 200)
        self.assertIn("text/csv", csv_response.content_type)
        excel_response = self.client.get(f"/api/reports/export/xlsx{filters}")
        self.assertEqual(excel_response.status_code, 200)
        self.assertTrue(excel_response.data.startswith(b"PK"))
        workbook = load_workbook(BytesIO(excel_response.data), read_only=True)
        self.assertEqual(workbook.active.max_row, 3)
        today = datetime.now(timezone.utc).date().isoformat()
        self.assertEqual(len(self.client.get(f"/api/reports/movements?from={today}&to={today}").get_json()), 2)
        self.assertEqual(self.client.get("/api/reports/movements?from=2030-02-01&to=2030-01-01").status_code, 400)

    def test_exports_neutralize_spreadsheet_formulas(self):
        with application.app.app_context():
            product = db.session.get(Product, self.product_id)
            product.name = "=SUM(1,1)"
            db.session.commit()
        csv_response = self.client.get("/api/reports/export/csv")
        self.assertIn(b"'=SUM(1,1)", csv_response.data)
        excel_response = self.client.get("/api/reports/export/xlsx")
        workbook = load_workbook(BytesIO(excel_response.data), read_only=True)
        self.assertEqual(workbook.active["B2"].value, "'=SUM(1,1)")

    def test_user_updates_are_audited_and_deactivation_revokes_access(self):
        client = application.app.test_client()
        login_page = client.get("/login")
        token = re.search(rb'name="csrf_token" value="([^"]+)"', login_page.data).group(1).decode()
        client.post("/login", data={"csrf_token": token, "email": "caio@example.com", "password": "SenhaSegura123"})
        admin_page = self.client.get("/")
        admin_token = re.search(rb'name="csrf-token" content="([^"]+)"', admin_page.data).group(1).decode()
        updated = self.client.put("/api/users/2", json={"name": "Caio Conferente", "role": "conferente", "active": False}, headers={"X-CSRFToken": admin_token})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(client.get("/api/me").status_code, 302)
        last_admin = self.client.put(f"/api/users/{self.admin_id}", json={"name": "Ana Administradora", "role": "conferente", "active": True}, headers={"X-CSRFToken": admin_token})
        self.assertEqual(last_admin.status_code, 400)
        audit = self.client.get("/api/audit").get_json()
        self.assertTrue(any(entry["action"] == "editar" and entry["entity"] == "usuario" for entry in audit))

    def test_backup_can_be_downloaded_and_restored(self):
        backup = self.client.get("/api/settings/backup")
        self.assertEqual(backup.status_code, 200)
        self.assertTrue(backup.data.startswith(b"SQLite format 3"))
        backup_bytes = backup.data
        backup.close()
        restored = self.client.post("/api/settings/restore", data={"file": (BytesIO(backup_bytes), "snapshot.sqlite")}, headers={"X-CSRFToken": self.csrf}, content_type="multipart/form-data")
        self.assertEqual(restored.status_code, 200, restored.get_json())
        self.assertEqual(self.client.get("/api/products").status_code, 200)

    def test_conferente_can_read_but_cannot_mutate_stock(self):
        client = application.app.test_client()
        login_page = client.get("/login")
        token = re.search(rb'name="csrf_token" value="([^"]+)"', login_page.data).group(1).decode()
        response = client.post("/login", data={"csrf_token": token, "email": "caio@example.com", "password": "SenhaSegura123"})
        self.assertEqual(response.status_code, 302)
        page = client.get("/")
        token = re.search(rb'name="csrf-token" content="([^"]+)"', page.data).group(1).decode()
        self.assertEqual(client.get("/api/products").status_code, 200)
        denied = client.post("/api/movements", json={"product_id": self.product_id, "kind": "saida", "quantity": 1}, headers={"X-CSRFToken": token})
        self.assertEqual(denied.status_code, 403)

    def test_session_survives_page_refresh_and_logout_revokes_access(self):
        self.assertEqual(self.client.get("/api/me").status_code, 200)
        self.assertEqual(self.client.get("/").status_code, 200)
        self.client.post("/logout", data={"csrf_token": self.csrf})
        self.assertEqual(self.client.get("/api/me").status_code, 302)
        self.client.post("/login", data={"csrf_token": self.csrf, "email": "ana@example.com", "password": "SenhaSegura123"})
        self.assertEqual(self.client.get("/api/products").get_json()[0]["stock"], 15)


if __name__ == "__main__":
    unittest.main()