const content = document.querySelector("#page-content");
const dialog = document.querySelector("#form-dialog");
const dialogContent = document.querySelector("#dialog-content");
const csrfToken = document.querySelector('meta[name="csrf-token"]').content;
const user = JSON.parse(document.body.dataset.user);

const pages = {
  inicio: ["Início", "VISÃO GERAL"],
  produtos: ["Produtos", "CADASTROS"],
  estoque: ["Estoque", "OPERAÇÃO"],
  notas: ["Notas fiscais", "ENTRADAS"],
  cargas: ["Conferência de cargas", "CONFERÊNCIA"],
  "cargas-lista": ["Cargas", "OPERAÇÃO"],
  inventario: ["Inventário", "CONTAGEM"],
  relatorios: ["Relatórios", "ANÁLISE"],
  usuarios: ["Usuários", "ADMINISTRAÇÃO"],
  configuracoes: ["Configurações", "ADMINISTRAÇÃO"],
};
const canStock = ["administrador", "almoxarife"].includes(user.role);
let currentPage = "inicio";
let selectedLoad = null;
let selectedInventory = null;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const initials = (name) => String(name || "A").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const formatNumber = (value) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(value || 0));
const formatDate = (value) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "-";
const statusPill = (label, type = "neutral") => `<span class="status status-${type}">${escapeHtml(label)}</span>`;
const isAdmin = user.role === "administrador";

document.querySelector("#user-name").textContent = user.name;
document.querySelector("#user-role").textContent = user.role_label;
document.querySelector("#user-avatar").textContent = initials(user.name);
document.querySelector("#topbar-avatar").textContent = initials(user.name);
document.querySelector("#today-label").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date());

if (!isAdmin) {
  document.querySelectorAll("[data-page='usuarios'], [data-page='configuracoes']").forEach((element) => element.classList.add("hidden"));
}
if (!canStock) {
  document.querySelectorAll("[data-page='produtos'], [data-page='estoque'], [data-page='notas'], [data-page='inventario']").forEach((element) => element.classList.add("hidden"));
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRFToken", csrfToken);
  }
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json() : null;
  if (response.status === 401 || response.redirected) {
    window.location.assign("/login");
    throw new Error("Sua sessão expirou.");
  }
  if (!response.ok) throw new Error(body?.error || `A solicitação falhou (${response.status}).`);
  return body;
}

function toast(message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast ${type === "error" ? "error" : "success"}`;
  element.textContent = message;
  document.querySelector("#toast-region").append(element);
  window.setTimeout(() => element.remove(), 4200);
}

function setPage(page) {
  if (!pages[page]) return;
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  document.querySelector("#breadcrumb").textContent = pages[page][1];
  document.querySelector("#page-heading").textContent = pages[page][0];
  document.querySelector("#sidebar").classList.remove("open");
  document.querySelector("#mobile-backdrop").classList.remove("visible");
  const views = {
    inicio: renderDashboard,
    produtos: renderProducts,
    estoque: renderStock,
    notas: renderInvoices,
    cargas: renderLoads,
    "cargas-lista": renderLoadList,
    inventario: renderInventory,
    relatorios: renderReports,
    usuarios: renderUsers,
    configuracoes: renderSettings,
  };
  content.innerHTML = `<div class="empty-state"><strong>Carregando</strong>Consultando o banco de dados...</div>`;
  views[page]().catch((error) => showError(error));
}

function showError(error) {
  content.innerHTML = `<div class="panel"><div class="empty-state"><strong>Não foi possível carregar esta tela</strong>${escapeHtml(error.message)}<br><button class="button" data-action="reload-page" style="margin-top:12px">Tentar novamente</button></div></div>`;
}

function intro(title, description, actions = "") {
  return `<div class="page-intro"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><div class="actions">${actions}</div></div>`;
}

function panel(title, body, options = {}) {
  const subtitle = options.subtitle ? `<div class="panel-subtitle">${escapeHtml(options.subtitle)}</div>` : "";
  const header = `<div class="panel-head"><div><h3>${escapeHtml(title)}</h3>${subtitle}</div>${options.action || ""}</div>`;
  return `<section class="panel">${header}${body}</section>`;
}

function emptyRow(columns, message) {
  return `<tr><td colspan="${columns}"><div class="empty-state"><strong>${escapeHtml(message)}</strong>Nenhum registro encontrado.</div></td></tr>`;
}

function table(headers, rows, count = null) {
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = rows.length ? rows.join("") : emptyRow(headers.length, "Tudo tranquilo por aqui");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${count !== null ? `<div class="panel-head"><span class="table-count">${count} registro${count === 1 ? "" : "s"}</span></div>` : ""}`;
}

function openForm(title, fields, onSubmit, description = "Preencha os dados para continuar.") {
  dialogContent.innerHTML = `
    <div class="dialog-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="Fechar">×</button></div>
    <form class="dialog-form" id="active-dialog-form" novalidate>
      <div class="dialog-fields">${fields.map(renderField).join("")}</div>
      <div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">Cancelar</button><button class="button button-primary" type="submit">Salvar</button></div>
    </form>`;
  dialog.showModal();
  const form = dialogContent.querySelector("form");
  form.querySelectorAll("[data-multi-search]").forEach((search) => {
    const fieldName = search.dataset.multiSearch;
    const options = [...form.querySelectorAll(`[data-multi-option="${fieldName}"]`)];
    const empty = form.querySelector(`[data-multi-empty="${fieldName}"]`);
    const count = form.querySelector(`[data-multi-count="${fieldName}"]`);
    const updateCount = () => {
      const selected = form.querySelectorAll(`input[name="${fieldName}"]:checked`).length;
      count.textContent = `${selected} selecionada${selected === 1 ? "" : "s"}`;
    };
    search.addEventListener("input", () => {
      const query = search.value.trim().toLocaleLowerCase("pt-BR");
      let visible = 0;
      options.forEach((option) => {
        option.hidden = !option.textContent.toLocaleLowerCase("pt-BR").includes(query);
        if (!option.hidden) visible += 1;
      });
      empty.hidden = visible > 0;
    });
    options.forEach((option) => option.querySelector("input").addEventListener("change", updateCount));
    updateCount();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const formData = new FormData(form);
      const data = Object.fromEntries(formData);
      for (const field of fields) {
        if (field.multiple) data[field.name] = formData.getAll(field.name);
        if (field.type === "number" && data[field.name] !== "") data[field.name] = Number(data[field.name]);
        const missing = Array.isArray(data[field.name]) ? data[field.name].length === 0 : !String(data[field.name] ?? "").trim();
        if (field.required && missing) throw new Error(`Preencha ${field.label.toLowerCase()}.`);
      }
      await onSubmit(data);
      dialog.close();
    } catch (error) {
      toast(error.message, "error");
      submit.disabled = false;
    }
  });
  dialogContent.querySelector("input:not([type=hidden]), select")?.focus();
}

function renderField(field) {
  const full = field.full ? " full" : "";
  const required = field.required ? " required" : "";
  const options = field.options || [];
  let input;
  if (field.type === "multiselect") {
    input = `<div class="multi-select"><input class="input" type="search" data-multi-search="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.searchPlaceholder || "Pesquisar...")}" autocomplete="off" aria-label="Pesquisar ${escapeHtml(field.label)}"><div class="multi-options" role="group" aria-label="${escapeHtml(field.label)}">${options.map((option) => `<label class="multi-option" data-multi-option="${escapeHtml(field.name)}"><input type="checkbox" name="${escapeHtml(field.name)}" value="${escapeHtml(option.value)}"><span>${escapeHtml(option.label)}</span></label>`).join("")}<div class="multi-empty" data-multi-empty="${escapeHtml(field.name)}" hidden>Nenhuma nota encontrada.</div></div><div class="multi-footer" data-multi-count="${escapeHtml(field.name)}">0 selecionadas</div></div>`;
  } else if (field.type === "select") {
    const multiple = field.multiple ? " multiple size=\"5\"" : "";
    const placeholder = field.multiple ? "" : `<option value="">${escapeHtml(field.placeholder || "Selecione")}</option>`;
    input = `<select class="select" name="${escapeHtml(field.name)}"${multiple}${required}>${placeholder}${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}</select>`;
  } else if (field.type === "checkbox") {
    input = `<input type="checkbox" name="${escapeHtml(field.name)}" value="true" ${field.checked ? "checked" : ""}>`;
  } else if (field.type === "file") {
    input = `<input class="input" type="file" name="${escapeHtml(field.name)}" ${field.accept ? `accept="${escapeHtml(field.accept)}"` : ""} ${field.multiple ? "multiple" : ""}${required}>`;
  } else if (field.type === "textarea") {
    input = `<textarea class="textarea" name="${escapeHtml(field.name)}" rows="${field.rows || 3}" placeholder="${escapeHtml(field.placeholder || "")}" maxlength="${field.maxlength || 2000}"${required}></textarea>`;
  } else {
    input = `<input class="input" type="${escapeHtml(field.type || "text")}" name="${escapeHtml(field.name)}" placeholder="${escapeHtml(field.placeholder || "")}" ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.step ? `step="${field.step}"` : ""}${required} autocomplete="${field.autocomplete || "off"}">`;
  }
  return `<div class="field${full}"><label>${escapeHtml(field.label)}</label>${input}</div>`;
}

async function renderDashboard() {
  const data = await api("/api/dashboard");
  const metrics = [
    ["Produtos ativos", data.products, "Base cadastrada", "▦"],
    ["Abaixo do mínimo", data.low_stock, "Precisam de reposição", "!"],
    ["Cargas em andamento", data.open_loads, "Aguardando conferência", "⇢"],
    ["Inventários abertos", data.open_inventories, "Contagens pendentes", "☷"],
  ];
  const metricHtml = metrics.map(([label, value, caption, icon]) => `<article class="metric-card"><div class="metric-label">${escapeHtml(label)}<span class="metric-icon">${icon}</span></div><div class="metric-value">${formatNumber(value)}</div><div class="metric-caption">${escapeHtml(caption)}</div></article>`).join("");
  const lowRows = data.low_products.map((item) => `<tr><td><span class="table-primary">${escapeHtml(item.name)}</span><span class="table-secondary">${escapeHtml(item.code)}</span></td><td>${escapeHtml(item.category)}</td><td>${formatNumber(item.stock)} ${escapeHtml(item.unit)}</td><td>${formatNumber(item.min_stock)} ${escapeHtml(item.unit)}</td><td>${statusPill("Reposição", "warn")}</td></tr>`);
  const recentRows = data.recent.map((item) => `<tr><td><span class="table-primary">${escapeHtml(item.product)}</span></td><td>${statusPill(item.kind, item.kind === "entrada" ? "ok" : item.kind === "saida" ? "danger" : "neutral")}</td><td>${formatNumber(item.quantity)} ${escapeHtml(item.unit)}</td><td>${escapeHtml(item.responsible)}</td></tr>`);
  content.innerHTML = `${intro(`Olá, ${user.name.split(" ")[0]}`, "Aqui está o resumo da operação de hoje.", `<button class="button" data-page-link="relatorios">Ver relatórios →</button>`)}<div class="metric-grid">${metricHtml}</div><div class="dashboard-grid">${panel("Produtos para repor", table(["Produto", "Categoria", "Em estoque", "Mínimo", "Situação"], lowRows), { subtitle: "Itens no limite ou abaixo do estoque mínimo" })}${panel("Movimentações recentes", table(["Produto", "Tipo", "Quantidade", "Responsável"], recentRows), { subtitle: "Últimas operações registradas" })}</div>`;
}

async function fetchSelectOptions() {
  const [categories, suppliers, products] = await Promise.all([api("/api/categories"), api("/api/suppliers"), api("/api/products")]);
  return { categories, suppliers, products };
}

async function renderProducts() {
  const term = new URLSearchParams(location.hash.includes("?") ? location.hash.split("?")[1] : "").get("q") || "";
  const [products, options] = await Promise.all([api(`/api/products?q=${encodeURIComponent(term)}`), fetchSelectOptions()]);
  const rows = products.map((product) => `<tr><td><span class="table-primary">${escapeHtml(product.name)}</span><span class="table-secondary">${escapeHtml(product.code)}${product.source_invoice_number ? ` · NF ${escapeHtml(product.source_invoice_number)}` : ""}</span></td><td>${escapeHtml(product.barcode || "-")}</td><td>${escapeHtml(product.category)}</td><td>${escapeHtml(product.supplier)}</td><td>${formatNumber(product.stock)} ${escapeHtml(product.unit)}</td><td>${formatNumber(product.min_stock)} ${escapeHtml(product.unit)}</td><td>${statusPill(product.low_stock ? "Reposição" : "Normal", product.low_stock ? "warn" : "ok")}</td><td>${canStock ? `<button class="button button-small" data-action="edit-product" data-id="${product.id}">Editar</button> <button class="button button-small button-danger" data-action="archive-product" data-id="${product.id}">Arquivar</button>` : ""}</td></tr>`);
  const actions = `${canStock ? `<button class="button" data-action="new-category">+ Categoria</button><button class="button" data-action="new-supplier">+ Fornecedor</button><button class="button button-primary" data-action="new-product">+ Produto</button>` : ""}`;
  const search = `<div class="filter-grid"><div class="field" style="grid-column:span 2"><label for="product-search">Buscar produto</label><input class="input" id="product-search" value="${escapeHtml(term)}" placeholder="Nome, código ou código de barras"></div><div class="filter-actions"><button class="button button-primary" data-action="search-products">Buscar</button><button class="button" data-action="clear-product-search">Limpar</button></div></div>`;
  content.innerHTML = `${intro("Produtos cadastrados", "Controle códigos, categorias, fornecedores e níveis mínimos.", actions)}${panel("Catálogo de produtos", `${search}${table(["Produto", "Código de barras", "Categoria", "Fornecedor", "Estoque", "Mínimo", "Situação", "Ações"], rows, products.length)}`, { subtitle: "Produtos ativos" })}`;
  content.dataset.products = JSON.stringify(products);
  content.dataset.categories = JSON.stringify(options.categories);
  content.dataset.suppliers = JSON.stringify(options.suppliers);
}

function productFields(product = {}) {
  const categories = JSON.parse(content.dataset.categories || "[]");
  const suppliers = JSON.parse(content.dataset.suppliers || "[]");
  const catOptions = categories.map((item) => ({ value: item.id, label: item.name }));
  const supOptions = suppliers.map((item) => ({ value: item.id, label: item.name }));
  return [
    { name: "code", label: "Código interno", required: true, placeholder: product.code || "Ex.: PRD-001" },
    { name: "barcode", label: "Código de barras", placeholder: product.barcode || "EAN ou GTIN" },
    { name: "name", label: "Nome do produto", required: true, full: true, placeholder: product.name || "Descrição do produto" },
    { name: "unit", label: "Unidade", required: true, placeholder: product.unit || "un" },
    { name: "min_stock", label: "Estoque mínimo", type: "number", min: 0, step: "0.001", placeholder: product.min_stock ?? "0" },
    { name: "category_id", label: "Categoria", type: "select", options: catOptions },
    { name: "supplier_id", label: "Fornecedor", type: "select", options: supOptions },
  ];
}

function productPayload(data) {
  return { ...data, category_id: data.category_id || null, supplier_id: data.supplier_id || null, min_stock: data.min_stock || 0 };
}

async function productForm(product = null) {
  openForm(product ? "Editar produto" : "Novo produto", productFields(product || {}), async (data) => {
    await api(product ? `/api/products/${product.id}` : "/api/products", { method: product ? "PUT" : "POST", body: JSON.stringify(productPayload(data)) });
    toast(product ? "Produto atualizado." : "Produto cadastrado.");
    await renderProducts();
  });
  if (product) {
    for (const [name, value] of Object.entries({ ...product, category_id: product.category_id || "", supplier_id: product.supplier_id || "" })) {
      const input = dialogContent.querySelector(`[name="${name}"]`);
      if (input) input.value = value;
    }
  }
}

async function renderStock() {
  const products = await api("/api/products");
  const movements = await api("/api/movements");
  const fields = products.map((product) => ({ value: product.id, label: `${product.name} (${product.code})` }));
  const rows = movements.map((movement) => `<tr><td>${formatDate(movement.created_at)}</td><td><span class="table-primary">${escapeHtml(movement.product)}</span><span class="table-secondary">${escapeHtml(movement.code)}</span></td><td>${statusPill(movement.kind, movement.kind === "entrada" ? "ok" : movement.kind === "saida" ? "danger" : "neutral")}</td><td>${formatNumber(movement.quantity)} ${escapeHtml(movement.unit)}</td><td>${escapeHtml(movement.reference || "-")}</td><td>${escapeHtml(movement.responsible)}</td></tr>`);
  const action = canStock ? `<button class="button button-primary" data-action="new-movement">+ Movimentação</button>` : "";
  content.innerHTML = `${intro("Movimentações de estoque", "Cada entrada, saída ou ajuste registra data e responsável.", action)}${panel("Registrar operação", canStock ? `<form class="inline-form" id="movement-form"><div class="field"><label>Produto</label><select class="select" name="product_id" required><option value="">Selecione</option>${fields.map((item) => `<option value="${item.value}">${escapeHtml(item.label)}</option>`).join("")}</select></div><div class="field"><label>Tipo</label><select class="select" name="kind"><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="ajuste">Ajuste (+/-)</option></select></div><div class="field"><label>Quantidade</label><input class="input" type="number" name="quantity" min="0.001" step="0.001" required placeholder="0"></div><div class="field"><label>Referência</label><input class="input" name="reference" placeholder="NF, pedido ou motivo"></div><button class="button button-primary" type="submit">Registrar</button></form>` : `<div class="panel-body"><p class="panel-subtitle">Seu perfil pode consultar o estoque, mas não registrar movimentações.</p></div>`)}${panel("Histórico de movimentações", table(["Data", "Produto", "Tipo", "Quantidade", "Referência", "Responsável"], rows, movements.length), { subtitle: "Até 500 movimentações mais recentes" })}`;
}

async function renderInvoices() {
  const invoices = await api("/api/invoices");
  const rows = invoices.map((invoice) => `<tr><td><span class="table-primary">NF ${escapeHtml(invoice.number)}</span><span class="table-secondary">${escapeHtml(invoice.filename)}</span></td><td>${escapeHtml(invoice.supplier)}</td><td>${escapeHtml(invoice.issued_at || "-")}</td><td><span class="table-primary">${invoice.items}</span></td><td>${escapeHtml(invoice.imported_by)}</td><td>${formatDate(invoice.imported_at)}</td><td>${statusPill("Importada", "ok")}</td><td>${canStock ? `<button class="button button-small button-danger" data-action="delete-invoice" data-id="${invoice.id}" data-number="${escapeHtml(invoice.number)}">Excluir</button>` : ""}</td></tr>`);
  content.innerHTML = `${intro("Notas fiscais", "Importe vários XML de NF-e de uma vez. A exclusão estorna as entradas vinculadas ao estoque.", canStock ? `<button class="button button-primary" data-action="import-invoice">↑ Importar XML</button>` : "")}${panel("Notas importadas", table(["Documento", "Fornecedor", "Emissão", "Itens", "Importada por", "Importação", "Situação", "Ações"], rows, invoices.length), { subtitle: "Até 20 XML por lote; processamento local sem serviços de IA" })}`;
}

async function renderLoads() {
  const [loads, products] = await Promise.all([api("/api/loads"), api("/api/products")]);
  const activeLoads = loads.filter((load) => load.status === "aberta");
  if (!selectedLoad || !activeLoads.some((load) => load.id === selectedLoad)) selectedLoad = activeLoads[0]?.id || null;
  const chips = activeLoads.map((load) => `<button class="load-chip ${load.id === selectedLoad ? "active" : ""}" data-action="select-load" data-id="${load.id}"><strong>${escapeHtml(load.reference)}</strong><span>${escapeHtml(load.supplier)} · ${load.checked}/${load.items} produtos</span><span>${escapeHtml(load.vehicle_plate || "Sem placa")} · ${escapeHtml(load.driver_name || "Sem motorista")}</span></button>`).join("");
  const selected = selectedLoad ? await api(`/api/loads/${selectedLoad}`) : null;
  const detailRows = selected?.items.map((item) => {
    const pending = item.checked === null;
    const state = pending ? statusPill("Pendente", "neutral") : item.checked >= item.expected ? statusPill("Conferido", "ok") : statusPill("Divergente", "warn");
    return `<tr><td><span class="table-primary">${escapeHtml(item.name)}</span><span class="table-secondary">${escapeHtml(item.code)} · ${escapeHtml(item.barcode || "sem código de barras")}</span></td><td>${formatNumber(item.expected)} ${escapeHtml(item.unit)}</td><td>${pending ? "Pendente" : `${formatNumber(item.checked)} ${escapeHtml(item.unit)}`}</td><td>${state}</td><td>${escapeHtml(item.checked_by || "-")}</td></tr>`;
  }) || [];
  const createButton = `<button class="button button-primary" data-action="new-load">+ Abrir carga</button>`;
  let body = `<div class="load-list">${chips || `<div class="empty-state">Nenhuma carga aberta para conferência.</div>`}</div>`;
  if (selected) {
    body += `<form class="scan-area" id="scan-form" data-load-id="${selected.id}"><div class="field"><label for="scan-barcode">Código de barras</label><input class="input scan-input" id="scan-barcode" name="barcode" autocomplete="off" placeholder="Leia ou digite o código" required></div><div class="field"><label for="scan-expected">Quantidade prevista</label><input class="input scan-input" id="scan-expected" name="expected_quantity" type="number" min="0.001" step="0.001" placeholder="NF ou romaneio"></div><div class="field"><label for="scan-quantity">Quantidade recebida</label><input class="input scan-input" id="scan-quantity" name="quantity" type="number" min="0.001" step="0.001" placeholder="Total recebido" required></div><button class="button button-primary" type="submit">Registrar produto</button><p class="scan-help">Leia o código uma vez por produto, informe o total recebido e compare com a quantidade prevista. Códigos repetidos são bloqueados.</p></form>`;
    body += table(["Produto", "Esperado", "Conferido", "Situação", "Responsável"], detailRows, selected.items.length);
    const invoiceLabel = selected.invoices.length ? ` · NF: ${selected.invoices.map((invoice) => `#${escapeHtml(invoice.number)}`).join(", ")}` : "";
    const transport = `<div class="load-meta"><span>Placa: ${escapeHtml(selected.vehicle_plate || "Não informada")}</span><span>Motorista: ${escapeHtml(selected.driver_name || "Não informado")}</span>${selected.observations ? `<span class="load-observations">Observações: ${escapeHtml(selected.observations)}</span>` : ""}</div>`;
    body += `<div class="panel-head"><span class="table-count">Carga ${escapeHtml(selected.reference)} · Fornecedor: ${escapeHtml(selected.supplier)}${invoiceLabel}</span>${canStock ? `<button class="button button-small" data-action="close-load" data-id="${selected.id}">Encerrar conferência</button>` : ""}</div>${transport}`;
  }
  content.innerHTML = `${intro("Conferência de cargas", "Leia o código de barras uma vez por produto e registre a quantidade total.", createButton)}${panel("Cargas em conferência", body, { subtitle: `${activeLoads.length} carga${activeLoads.length === 1 ? " aberta" : "s abertas"}` })}`;
  content.dataset.loadProducts = JSON.stringify(products);
  if (selected) {
    const barcodeInput = content.querySelector("#scan-barcode");
    const expectedInput = content.querySelector("#scan-expected");
    barcodeInput?.addEventListener("input", () => {
      const matched = selected.items.find((item) => item.barcode && item.barcode === barcodeInput.value.trim() && item.checked === null);
      expectedInput.value = matched ? matched.expected : "";
      expectedInput.readOnly = Boolean(matched);
    });
    barcodeInput?.focus();
  }
}

async function renderLoadList() {
  const loads = await api("/api/loads");
  const rows = loads.map((load) => `<tr><td><span class="table-primary">${escapeHtml(load.reference)}</span>${load.observations ? `<span class="table-secondary">${escapeHtml(load.observations)}</span>` : ""}</td><td>${escapeHtml(load.supplier)}</td><td>${escapeHtml(load.vehicle_plate || "-")}</td><td>${escapeHtml(load.driver_name || "-")}</td><td>${load.checked}/${load.items} produtos</td><td>${statusPill(load.status === "aberta" ? "Em conferência" : "Conferida", load.status === "aberta" ? "warn" : "ok")}</td><td>${escapeHtml(load.created_by)}</td><td>${formatDate(load.created_at)}</td><td>${load.status === "aberta" ? `<button class="button button-small" data-action="open-load" data-id="${load.id}">Conferir</button>` : ""}</td></tr>`);
  content.innerHTML = `${intro("Cargas", "Acompanhe referências, notas, transporte e andamento da conferência.", `<button class="button button-primary" data-action="new-load">+ Nova carga</button>`)}${panel("Todas as cargas", table(["Referência", "Fornecedor", "Placa", "Motorista", "Itens conferidos", "Situação", "Criada por", "Abertura", "Ação"], rows, loads.length))}`;
}

async function renderInventory() {
  if (selectedInventory) return renderInventoryDetail(selectedInventory);
  const inventories = await api("/api/inventories");
  const rows = inventories.map((inventory) => `<tr><td><span class="table-primary">${escapeHtml(inventory.reference)}</span></td><td>${inventory.counted}/${inventory.items}</td><td>${statusPill(inventory.status === "aberto" ? "Aberto" : "Concluído", inventory.status === "aberto" ? "warn" : "ok")}</td><td>${escapeHtml(inventory.created_by)}</td><td>${formatDate(inventory.created_at)}</td><td><button class="button button-small" data-action="open-inventory" data-id="${inventory.id}">${inventory.status === "aberto" ? "Contar" : "Ver"}</button></td></tr>`);
  content.innerHTML = `${intro("Inventário", "Compare o saldo do sistema com a contagem física.", canStock ? `<button class="button button-primary" data-action="new-inventory">+ Abrir inventário</button>` : "")}${panel("Contagens", table(["Referência", "Produtos contados", "Situação", "Criado por", "Abertura", ""], rows, inventories.length))}`;
}

async function renderInventoryDetail(inventoryId) {
  const inventory = await api(`/api/inventories/${inventoryId}`);
  const editable = inventory.status === "aberto" && canStock;
  const rows = inventory.items.map((item) => `<tr><td><span class="table-primary">${escapeHtml(item.name)}</span><span class="table-secondary">${escapeHtml(item.code)} · ${escapeHtml(item.barcode || "sem código de barras")}</span></td><td>${formatNumber(item.expected)} ${escapeHtml(item.unit)}</td><td>${editable ? `<form class="count-form" data-inventory-id="${inventory.id}" data-item-id="${item.id}" style="display:flex;gap:6px"><input class="input" aria-label="Quantidade contada" type="number" name="counted" min="0" step="0.001" value="${item.counted === null ? "" : item.counted}" required style="max-width:105px"><button class="button button-small">Salvar</button></form>` : item.counted === null ? "-" : `${formatNumber(item.counted)} ${escapeHtml(item.unit)}`}</td><td>${item.counted === null ? statusPill("Pendente", "neutral") : item.counted === item.expected ? statusPill("Confere", "ok") : statusPill(`Diferença ${formatNumber(item.counted - item.expected)}`, "warn")}</td></tr>`);
  const controls = `<button class="button" data-action="back-inventory">← Voltar</button>${editable ? `<button class="button button-primary" data-action="close-inventory" data-id="${inventory.id}">Fechar e ajustar estoque</button>` : ""}`;
  content.innerHTML = `${intro(`Inventário ${inventory.reference}`, "Registre a quantidade física de cada produto. Ao concluir, o saldo será ajustado.", controls)}${panel("Contagem por produto", table(["Produto", "Saldo no sistema", "Contagem física", "Conferência"], rows, inventory.items.length))}`;
}

async function renderReports() {
  const filters = await api("/api/reports/filters");
  content.innerHTML = `${intro("Relatórios", "Filtre movimentações por período, produto, categoria, fornecedor e responsável.", `<button class="button" data-action="export-report" data-format="csv">↓ CSV</button><button class="button button-primary" data-action="export-report" data-format="xlsx">↓ Excel</button>`)}<section class="panel"><div class="panel-head"><div><h3>Filtros</h3><div class="panel-subtitle">Os arquivos exportados respeitam os mesmos critérios</div></div><button class="button button-small" data-action="clear-report">Limpar filtros</button></div><div class="filter-grid"><div class="field"><label>De</label><input class="input report-filter" type="date" name="from"></div><div class="field"><label>Até</label><input class="input report-filter" type="date" name="to"></div><div class="field"><label>Produto</label><select class="select report-filter" name="product_id"><option value="">Todos</option>${filters.products.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("")}</select></div><div class="field"><label>Categoria</label><select class="select report-filter" name="category_id"><option value="">Todas</option>${filters.categories.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("")}</select></div><div class="field"><label>Fornecedor</label><select class="select report-filter" name="supplier_id"><option value="">Todos</option>${filters.suppliers.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("")}</select></div><div class="field"><label>Responsável</label><select class="select report-filter" name="responsible_id"><option value="">Todos</option>${filters.users.map((x) => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("")}</select></div><div class="filter-actions"><button class="button button-primary" data-action="apply-report">Aplicar filtros</button></div></div></section><div id="report-results"></div>`;
  await loadReportResults();
}

function reportQuery() {
  const params = new URLSearchParams();
  content.querySelectorAll(".report-filter").forEach((input) => { if (input.value) params.set(input.name, input.value); });
  return params;
}

async function loadReportResults() {
  const results = content.querySelector("#report-results");
  if (!results) return;
  const rows = await api(`/api/reports/movements?${reportQuery()}`);
  const tableRows = rows.map((row) => `<tr><td>${formatDate(row.date)}</td><td><span class="table-primary">${escapeHtml(row.product)}</span><span class="table-secondary">${escapeHtml(row.code)}</span></td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.supplier)}</td><td>${statusPill(row.kind, row.kind === "entrada" ? "ok" : row.kind === "saida" ? "danger" : "neutral")}</td><td>${formatNumber(row.quantity)} ${escapeHtml(row.unit)}</td><td>${escapeHtml(row.reference || "-")}</td><td>${escapeHtml(row.responsible)}</td></tr>`);
  results.innerHTML = panel("Movimentações", table(["Data", "Produto", "Categoria", "Fornecedor", "Tipo", "Quantidade", "Referência", "Responsável"], tableRows, rows.length), { subtitle: "Até 5.000 registros por consulta" });
}

async function renderUsers() {
  const users = await api("/api/users");
  const rows = users.map((item) => `<tr><td><span class="table-primary">${escapeHtml(item.name)}</span></td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(item.role_label)}</td><td>${statusPill(item.active ? "Ativo" : "Inativo", item.active ? "ok" : "neutral")}</td><td><button class="button button-small" data-action="edit-user" data-id="${item.id}">Editar</button></td></tr>`);
  content.innerHTML = `${intro("Usuários e permissões", "Administre o acesso por função e mantenha o registro dos responsáveis.", `<button class="button button-primary" data-action="new-user">+ Novo usuário</button>`)}${panel("Contas do sistema", table(["Nome", "E-mail", "Perfil", "Acesso", ""], rows, users.length))}`;
  content.dataset.users = JSON.stringify(users);
}

async function renderSettings() {
  content.innerHTML = `${intro("Configurações", "Proteja seus dados e gerencie cópias de segurança.")}<div class="settings-grid"><section class="panel settings-card"><h3>Backup do banco</h3><p>Baixe uma cópia íntegra do banco SQLite. Mantenha o arquivo em um local seguro e fora deste servidor.</p><div class="setting-actions"><button class="button button-primary" data-action="download-backup">↓ Baixar backup</button><button class="button" data-action="backup-command">Gerar backup local</button></div></section><section class="panel settings-card"><h3>Restaurar dados</h3><p>Recupera usuários, produtos, estoque, notas e conferências a partir de um backup SQLite validado.</p><div class="setting-actions"><input class="hidden" type="file" id="restore-file" accept=".sqlite,.db,.backup"><button class="button" data-action="choose-restore">↑ Selecionar backup</button><span class="table-count" id="restore-name">Nenhum arquivo selecionado</span></div></section><section class="panel settings-card"><h3>Catálogo de apoio</h3><p>Crie categorias e fornecedores pela tela de produtos, sem duplicar nomes ou documentos.</p><button class="button" data-page-link="produtos">Abrir produtos →</button></section><section class="panel settings-card"><h3>Controle de acesso</h3><p>Apenas administradores gerenciam usuários, perfis, backup e restauração.</p><span class="status status-ok">Acesso: ${escapeHtml(user.role_label)}</span></section></div>`;
    const entries = await api("/api/audit");
    const auditRows = entries.slice(0, 20).map((entry) => `<tr><td>${formatDate(entry.created_at)}</td><td>${escapeHtml(entry.actor)}</td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.entity)} #${escapeHtml(entry.record_id)}</td><td>${escapeHtml(Object.values(entry.details).join(" · ") || "-")}</td></tr>`);
    content.innerHTML = `${intro("Configurações", "Proteja seus dados e gerencie cópias de segurança.")}<div class="settings-grid"><section class="panel settings-card"><h3>Backup do banco</h3><p>Baixe uma cópia íntegra do banco SQLite. Mantenha o arquivo em um local seguro e fora deste servidor.</p><div class="setting-actions"><button class="button button-primary" data-action="download-backup">↓ Baixar backup</button><button class="button" data-action="backup-command">Gerar backup local</button></div></section><section class="panel settings-card"><h3>Restaurar dados</h3><p>Recupera usuários, produtos, estoque, notas e conferências a partir de um backup SQLite validado.</p><div class="setting-actions"><input class="hidden" type="file" id="restore-file" accept=".sqlite,.db,.backup"><button class="button" data-action="choose-restore">↑ Selecionar backup</button><span class="table-count" id="restore-name">Nenhum arquivo selecionado</span></div></section><section class="panel settings-card"><h3>Catálogo de apoio</h3><p>Crie categorias e fornecedores pela tela de produtos, sem duplicar nomes ou documentos.</p><button class="button" data-page-link="produtos">Abrir produtos →</button></section><section class="panel settings-card"><h3>Controle de acesso</h3><p>Apenas administradores gerenciam usuários, perfis, backup e restauração.</p><span class="status status-ok">Acesso: ${escapeHtml(user.role_label)}</span></section></div>${panel("Registro de operações administrativas", table(["Data", "Responsável", "Ação", "Registro", "Detalhes"], auditRows, entries.length), { subtitle: "Acessível apenas ao administrador" })}`;
}

function getUser(id) {
  return JSON.parse(content.dataset.users || "[]").find((item) => item.id === Number(id));
}

function download(url) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}

document.addEventListener("click", async (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    event.preventDefault();
    setPage(pageButton.dataset.page);
    return;
  }
  const pageLink = event.target.closest("[data-page-link]");
  if (pageLink) {
    setPage(pageLink.dataset.pageLink);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id, format } = button.dataset;
  try {
    if (action === "close-dialog") dialog.close();
    if (action === "reload-page") setPage(currentPage);
    if (action === "new-product") await productForm();
    if (action === "edit-product") {
      const product = JSON.parse(content.dataset.products || "[]").find((item) => item.id === Number(id));
      if (product) await productForm(product);
    }
    if (action === "search-products") {
      const query = content.querySelector("#product-search").value.trim();
      await renderProductsWithSearch(query);
    }
    if (action === "clear-product-search") await renderProductsWithSearch("");
    if (action === "new-category") openForm("Nova categoria", [{ name: "name", label: "Nome da categoria", required: true, full: true }], async (data) => {
      await api("/api/categories", { method: "POST", body: JSON.stringify(data) });
      toast("Categoria cadastrada.");
      await renderProducts();
    });
    if (action === "new-supplier") openForm("Novo fornecedor", [
      { name: "name", label: "Nome do fornecedor", required: true, full: true },
      { name: "document", label: "CNPJ ou documento" },
      { name: "phone", label: "Telefone" },
      { name: "email", label: "E-mail", type: "email", full: true },
    ], async (data) => {
      await api("/api/suppliers", { method: "POST", body: JSON.stringify(data) });
      toast("Fornecedor cadastrado.");
      await renderProducts();
    });
    if (action === "new-movement") {
      const products = await api("/api/products");
      openForm("Movimentar estoque", [
        { name: "product_id", label: "Produto", type: "select", required: true, options: products.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })) },
        { name: "kind", label: "Movimentação", type: "select", required: true, options: [{ value: "entrada", label: "Entrada" }, { value: "saida", label: "Saída" }, { value: "ajuste", label: "Ajuste positivo ou negativo" }] },
        { name: "quantity", label: "Quantidade", type: "number", required: true, step: "0.001" },
        { name: "reference", label: "Referência", full: true, placeholder: "Número de NF, pedido ou motivo" },
      ], async (data) => {
        await api("/api/movements", { method: "POST", body: JSON.stringify({ ...data, product_id: Number(data.product_id), quantity: Number(data.quantity) }) });
        toast("Movimentação registrada.");
        await renderStock();
      });
    }
    if (action === "import-invoice") {
      openForm("Importar notas fiscais XML", [{ name: "files", label: "Arquivos XML de NF-e (até 20 arquivos)", type: "file", accept: ".xml,text/xml,application/xml", multiple: true, required: true, full: true }], async (_data) => {
        const selectedFiles = [...dialogContent.querySelector('[name="files"]').files];
        if (!selectedFiles.length) throw new Error("Selecione pelo menos um arquivo XML.");
        if (selectedFiles.length > 20) throw new Error("Selecione no máximo 20 notas por lote.");
        const formData = new FormData();
        selectedFiles.forEach((file) => formData.append("files", file));
        const result = await api("/api/invoices/import", { method: "POST", body: formData });
        toast(`${result.imported} nota(s) importada(s); ${result.failed} falha(s).`, result.failed ? "error" : "success");
        result.results.filter((item) => !item.ok).slice(0, 3).forEach((item) => toast(`${item.filename}: ${item.error}`, "error"));
        await renderInvoices();
      }, "Cada nota é validada individualmente. A chave de acesso bloqueia importações repetidas.");
    }
    if (action === "delete-invoice" && window.confirm(`Excluir a NF ${button.dataset.number}? As entradas vinculadas serão estornadas. Se o estoque já tiver sido consumido, a exclusão será bloqueada.`)) {
      const result = await api(`/api/invoices/${id}`, { method: "DELETE" });
      toast(result.message);
      await renderInvoices();
    }
    if (action === "new-load") {
      const invoices = await api("/api/invoices");
      const invoiceOptions = invoices.map((invoice) => ({
        value: invoice.id,
        label: `NF ${invoice.number} · ${invoice.supplier} · ${invoice.items} itens`,
      }));
      openForm("Abrir carga", [
        { name: "reference", label: "Referência da carga", required: true, placeholder: "Ex.: CARGA-2026-001" },
        { name: "invoice_ids", label: "Notas fiscais desta carga", type: "multiselect", searchPlaceholder: "Buscar por número ou fornecedor", options: invoiceOptions, full: true },
        { name: "supplier", label: "Fornecedor (se não selecionar NF)", placeholder: "Transportadora ou fornecedor", full: true },
        { name: "vehicle_plate", label: "Placa do veículo", placeholder: "Ex.: ABC1D23" },
        { name: "driver_name", label: "Motorista", placeholder: "Nome completo" },
        { name: "observations", label: "Observações", type: "textarea", rows: 3, maxlength: 2000, placeholder: "Informações adicionais da carga", full: true },
      ], async (data) => {
        if (!data.invoice_ids.length && !data.supplier.trim()) throw new Error("Selecione uma nota fiscal ou informe o fornecedor.");
        const load = await api("/api/loads", { method: "POST", body: JSON.stringify(data) });
        selectedLoad = load.id;
        toast(`Carga aberta com ${load.invoices.length} NF(s) e ${load.items} produto(s) esperado(s).`);
        setPage("cargas");
      }, "Selecione uma ou mais notas recebidas. Os produtos e quantidades previstos serão carregados para conferência.");
    }
    if (action === "select-load") {
      selectedLoad = Number(id);
      await renderLoads();
    }
    if (action === "open-load") {
      selectedLoad = Number(id);
      setPage("cargas");
    }
    if (action === "close-load" && window.confirm("Encerrar a conferência desta carga?")) {
      await api(`/api/loads/${id}/close`, { method: "POST", body: "{}" });
      selectedLoad = null;
      toast("Carga encerrada.");
      await renderLoads();
    }
    if (action === "new-inventory") openForm("Abrir inventário", [{ name: "reference", label: "Referência", required: true, full: true, placeholder: "Ex.: INV-2026-001" }], async (data) => {
      const inventory = await api("/api/inventories", { method: "POST", body: JSON.stringify(data) });
      selectedInventory = inventory.id;
      toast(`Inventário aberto com ${inventory.items} produtos.`);
      await renderInventory();
    });
    if (action === "open-inventory") {
      selectedInventory = Number(id);
      await renderInventory();
    }
    if (action === "back-inventory") {
      selectedInventory = null;
      await renderInventory();
    }
    if (action === "close-inventory" && window.confirm("Fechar o inventário e ajustar os saldos do estoque?")) {
      await api(`/api/inventories/${id}/close`, { method: "POST", body: "{}" });
      toast("Inventário fechado. Saldos ajustados.");
      selectedInventory = null;
      await renderInventory();
    }
    if (action === "apply-report") await loadReportResults();
    if (action === "clear-report") {
      content.querySelectorAll(".report-filter").forEach((input) => { input.value = ""; });
      await loadReportResults();
    }
    if (action === "export-report") download(`/api/reports/export/${format}?${reportQuery()}`);
    if (action === "new-user") userForm();
    if (action === "edit-user") {
      const target = getUser(id);
      if (target) userForm(target);
    }
    if (action === "download-backup") download("/api/settings/backup");
    if (action === "backup-command") toast("Use flask --app app backup-db no terminal para salvar uma cópia local.", "info");
    if (action === "choose-restore") content.querySelector("#restore-file").click();
  } catch (error) {
    toast(error.message, "error");
  }
});

async function renderProductsWithSearch(query) {
  content.innerHTML = `<div class="empty-state">Buscando produtos...</div>`;
  const products = await api(`/api/products?q=${encodeURIComponent(query)}`);
  const options = await fetchSelectOptions();
  const rows = products.map((product) => `<tr><td><span class="table-primary">${escapeHtml(product.name)}</span><span class="table-secondary">${escapeHtml(product.code)}${product.source_invoice_number ? ` · NF ${escapeHtml(product.source_invoice_number)}` : ""}</span></td><td>${escapeHtml(product.barcode || "-")}</td><td>${escapeHtml(product.category)}</td><td>${escapeHtml(product.supplier)}</td><td>${formatNumber(product.stock)} ${escapeHtml(product.unit)}</td><td>${formatNumber(product.min_stock)} ${escapeHtml(product.unit)}</td><td>${statusPill(product.low_stock ? "Reposição" : "Normal", product.low_stock ? "warn" : "ok")}</td><td>${canStock ? `<button class="button button-small" data-action="edit-product" data-id="${product.id}">Editar</button> <button class="button button-small button-danger" data-action="archive-product" data-id="${product.id}">Arquivar</button>` : ""}</td></tr>`);
  const actions = `${canStock ? `<button class="button" data-action="new-category">+ Categoria</button><button class="button" data-action="new-supplier">+ Fornecedor</button><button class="button button-primary" data-action="new-product">+ Produto</button>` : ""}`;
  const search = `<div class="filter-grid"><div class="field" style="grid-column:span 2"><label for="product-search">Buscar produto</label><input class="input" id="product-search" value="${escapeHtml(query)}" placeholder="Nome, código ou código de barras"></div><div class="filter-actions"><button class="button button-primary" data-action="search-products">Buscar</button><button class="button" data-action="clear-product-search">Limpar</button></div></div>`;
  content.innerHTML = `${intro("Produtos cadastrados", "Controle códigos, categorias, fornecedores e níveis mínimos.", actions)}${panel("Catálogo de produtos", `${search}${table(["Produto", "Código de barras", "Categoria", "Fornecedor", "Estoque", "Mínimo", "Situação", "Ações"], rows, products.length)}`, { subtitle: "Produtos ativos" })}`;
  content.dataset.products = JSON.stringify(products);
  content.dataset.categories = JSON.stringify(options.categories);
  content.dataset.suppliers = JSON.stringify(options.suppliers);
}

function userForm(target = null) {
  const roles = [
    { value: "administrador", label: "Administrador" },
    { value: "almoxarife", label: "Almoxarife" },
    { value: "conferente", label: "Conferente" },
  ];
  const fields = [
    { name: "name", label: "Nome", required: true, full: true, placeholder: target?.name || "Nome completo" },
    { name: "email", label: "E-mail", type: "email", required: !target, full: true, placeholder: target?.email || "nome@empresa.com.br" },
    { name: "role", label: "Perfil de acesso", type: "select", required: true, options: roles },
    { name: "password", label: target ? "Nova senha (opcional)" : "Senha (mín. 10 caracteres)", type: "password", required: !target, full: true },
    ...(target ? [{ name: "active", label: "Acesso ativo", type: "select", options: [{ value: "true", label: "Ativo" }, { value: "false", label: "Inativo" }] }] : []),
  ];
  openForm(target ? "Editar usuário" : "Novo usuário", fields, async (data) => {
    const body = { name: data.name, role: data.role, active: data.active === undefined ? true : data.active === "true" };
    if (!target || data.email) body.email = data.email;
    if (data.password) body.password = data.password;
    await api(target ? `/api/users/${target.id}` : "/api/users", { method: target ? "PUT" : "POST", body: JSON.stringify(body) });
    toast(target ? "Usuário atualizado." : "Usuário criado.");
    await renderUsers();
  });
  if (target) {
    dialogContent.querySelector('[name="email"]').value = target.email;
    dialogContent.querySelector('[name="email"]').disabled = true;
    dialogContent.querySelector('[name="role"]').value = target.role;
    dialogContent.querySelector('[name="active"]').value = String(target.active);
  }
}

document.addEventListener("submit", async (event) => {
  if (event.target.matches("#movement-form")) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    try {
      await api("/api/movements", { method: "POST", body: JSON.stringify({ ...data, product_id: Number(data.product_id), quantity: Number(data.quantity) }) });
      toast("Movimentação registrada.");
      await renderStock();
    } catch (error) { toast(error.message, "error"); }
  }
  if (event.target.matches("#scan-form")) {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await api(`/api/loads/${form.dataset.loadId}/scan`, { method: "POST", body: JSON.stringify({ barcode: data.barcode, quantity: Number(data.quantity), ...(data.expected_quantity ? { expected_quantity: Number(data.expected_quantity) } : {}) }) });
      toast(`${result.name}: ${formatNumber(result.checked)} recebida(s), ${formatNumber(result.expected)} prevista(s).`);
      await renderLoads();
    } catch (error) {
      toast(error.message, "error");
      submit.disabled = false;
      form.querySelector("#scan-barcode")?.focus();
      form.querySelector("#scan-barcode")?.select();
    }
  }
  if (event.target.matches(".count-form")) {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    try {
      await api(`/api/inventories/${form.dataset.inventoryId}/items/${form.dataset.itemId}`, { method: "PUT", body: JSON.stringify({ counted: Number(data.counted) }) });
      toast("Contagem salva.");
      await renderInventoryDetail(Number(form.dataset.inventoryId));
    } catch (error) { toast(error.message, "error"); }
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.matches("#restore-file")) {
    const file = event.target.files?.[0];
    if (!file) return;
    document.querySelector("#restore-name").textContent = file.name;
    if (!window.confirm(`Restaurar ${file.name}? Os dados atuais do banco serão substituídos.`)) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const result = await api("/api/settings/restore", { method: "POST", body: formData });
      toast(result.message);
      window.setTimeout(() => window.location.assign("/login"), 1200);
    } catch (error) { toast(error.message, "error"); }
  }
});

document.querySelector("#mobile-menu").addEventListener("click", () => {
  document.querySelector("#sidebar").classList.add("open");
  document.querySelector("#mobile-backdrop").classList.add("visible");
});
document.querySelector("#mobile-backdrop").addEventListener("click", () => {
  document.querySelector("#sidebar").classList.remove("open");
  document.querySelector("#mobile-backdrop").classList.remove("visible");
});
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
setPage("inicio");