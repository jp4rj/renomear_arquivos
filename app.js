// ============================================
// Configuração do pdf.js
// ============================================
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

console.log("✅ app.js carregado");

// ============================================
// Padrões de extração do nome
// ============================================
const PADROES_NOME = [
  /Eleitor\(?a?\)?\s*[:\-]\s*([A-ZÀ-Ú][A-ZÀ-Ú\s]{4,80})/,
  /[Dd]eclaro(?:\s+para\s+os\s+devidos\s+fins)?,?\s+que\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-ú]+){1,5})/,
  /\beu,?\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-ú]+){1,5})/,
  /Nome(?:\s+completo)?[:\-]\s*([A-ZÀ-Ú][^\n]{3,60})/,
  /[Dd]eclarante[:\-]?\s+([A-ZÀ-Ú][^\n]{3,60})/,
  /([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-ú]+){1,5})\s*\n\s*CPF[:\s]*\d{3}\.\d{3}\.\d{3}-\d{2}/,
];

const PALAVRAS_PROIBIDAS = new Set([
  "Declaração", "Declaro", "Brasil", "República", "Federativa",
  "Ministério", "Secretaria", "Estado", "Município", "Prefeitura",
  "Universidade", "Escola", "Certidão", "Declarante",
]);

// ============================================
// Extração de CPF
// ============================================
const REGEX_CPF_PONTUADO = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;

function extrairCpfDigitos(texto) {
  const matches = texto.match(REGEX_CPF_PONTUADO);
  if (matches && matches.length) return soDigitos(matches[0]);

  const m = texto.match(/(?<!\d)\d{11}(?!\d)/);
  if (m) return m[0];

  return "";
}

function soDigitos(s) {
  return (s || "").replace(/\D/g, "");
}

// ============================================
// Leitura de PDF
// ============================================
async function lerPdf(file) {
  console.log("📖 Lendo:", file.name);
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  console.log("   páginas:", pdf.numPages);

  let texto = "";
  const totalPaginas = Math.min(pdf.numPages, 5);
  for (let i = 1; i <= totalPaginas; i++) {
    const pagina = await pdf.getPage(i);
    const conteudo = await pagina.getTextContent();
    texto += conteudo.items.map(item => item.str).join(" ") + "\n";
  }
  return texto;
}

// ============================================
// Extração de nome
// ============================================
function nomeValido(nome) {
  if (!nome) return false;
  const n = nome.trim();
  if (n.length < 5 || n.length > 80) return false;

  const partes = n.split(/\s+/);
  if (partes.length < 2) return false;

  const partesNorm = partes.map(p =>
    p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
  );
  if (partesNorm.some(p => PALAVRAS_PROIBIDAS.has(p))) return false;
  if (/\d/.test(n)) return false;
  return true;
}

function extrairNome(texto) {
  const textoNorm = texto.replace(/[ \t]+/g, " ");

  for (const padrao of PADROES_NOME) {
    const matches = textoNorm.matchAll(new RegExp(padrao, "g"));
    for (const m of matches) {
      let nome = m[1].replace(/\s+/g, " ").trim();
      nome = nome.replace(/\s+CPF.*$/i, "").trim();
      nome = nome.replace(/\s+(Eleição|Eleitor|Título|RG|Data).*$/i, "").trim();
      if (nomeValido(nome)) return nome;
    }
  }

  const linhas = texto.split("\n").map(l => l.trim()).filter(Boolean);
  const ultimas = linhas.slice(-15);
  for (let i = ultimas.length - 1; i >= 0; i--) {
    const linha = ultimas[i];
    if (/^[A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)+$/.test(linha) && nomeValido(linha)) {
      return linha;
    }
  }

  return "";
}

function sanitizarNome(nome) {
  return nome
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s\-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// ============================================
// Estado
// ============================================
const estado = {
  arquivos: [],
  prefixo: "",
  sufixo: "",
};

// ============================================
// Elementos da UI
// ============================================
const dropzone = document.getElementById("dropzone");
const inputArquivos = document.getElementById("arquivos");
const progressoContainer = document.getElementById("progresso-container");
const progressoBarra = document.getElementById("progresso-barra");
const progressoTexto = document.getElementById("progresso-texto");
const tabelaContainer = document.getElementById("tabela-container");
const tabelaCorpo = document.querySelector("#tabela tbody");
const btnBaixarZip = document.getElementById("baixar-zip");
const btnAprovarTodos = document.getElementById("aprovar-todos");
const btnDesmarcarTodos = document.getElementById("desmarcar-todos");
const btnProtegerTodos = document.getElementById("proteger-todos");
const btnDesprotegerTodos = document.getElementById("desproteger-todos");
const btnLimpar = document.getElementById("limpar");
const infoDownload = document.getElementById("info-download");

const inputPrefixo = document.getElementById("prefixo");
const inputSufixo = document.getElementById("sufixo");
const btnLimparAfixos = document.getElementById("limpar-afixos");

const btnTema = document.getElementById("btn-tema");
const iconeTema = btnTema.querySelector(".icone-tema");

// ============================================
// Tema
// ============================================
function temaAtual() {
  const atributo = document.documentElement.getAttribute("data-tema");
  if (atributo === "escuro" || atributo === "claro") return atributo;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro";
}

function aplicarIconeTema() {
  const tema = temaAtual();
  iconeTema.textContent = tema === "escuro" ? "☀️" : "🌙";
}

function alternarTema() {
  const novo = temaAtual() === "escuro" ? "claro" : "escuro";
  document.documentElement.setAttribute("data-tema", novo);
  localStorage.setItem("tema", novo);
  aplicarIconeTema();
}

btnTema.addEventListener("click", alternarTema);
aplicarIconeTema();

// ============================================
// Drag & drop
// ============================================
["dragenter", "dragover"].forEach(evt => {
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.add("ativo");
  });
});

["dragleave", "drop"].forEach(evt => {
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.remove("ativo");
  });
});

dropzone.addEventListener("drop", e => {
  const arquivos = Array.from(e.dataTransfer.files).filter(f =>
    f.name.toLowerCase().endsWith(".pdf")
  );
  if (arquivos.length) processarArquivos(arquivos);
});

inputArquivos.addEventListener("change", e => {
  const arquivos = Array.from(e.target.files);
  if (arquivos.length) processarArquivos(arquivos);
  inputArquivos.value = "";
});

inputPrefixo.addEventListener("input", () => {
  estado.prefixo = inputPrefixo.value;
  reconstruirTodosNovosNomes();
});

inputSufixo.addEventListener("input", () => {
  estado.sufixo = inputSufixo.value;
  reconstruirTodosNovosNomes();
});

btnLimparAfixos.addEventListener("click", () => {
  inputPrefixo.value = "";
  inputSufixo.value = "";
  estado.prefixo = "";
  estado.sufixo = "";
  reconstruirTodosNovosNomes();
});

// ============================================
// Processamento
// ============================================
async function processarArquivos(arquivos) {
  console.log("🚀 Processando", arquivos.length, "arquivo(s)");
  progressoContainer.classList.remove("oculto");
  tabelaContainer.classList.remove("oculto");

  let processados = 0;
  const total = arquivos.length;
  atualizarProgresso(0, total);

  for (const file of arquivos) {
    try {
      const texto = await lerPdf(file);
      const nome = extrairNome(texto);
      const cpf = extrairCpfDigitos(texto);
      console.log("   nome:", nome || "(vazio)", "| cpf:", cpf || "(vazio)");

      const item = {
        file,
        nomeOriginal: file.name,
        nomeExtraido: nome,
        senha: cpf,
        proteger: false,      // 🔒 por padrão NÃO protege
        aprovado: !!nome,
        novoNome: "",
      };
      estado.arquivos.push(item);
      adicionarLinhaTabela(item);
      atualizarNovoNomeItem(item);
    } catch (err) {
      console.error("Erro ao ler", file.name, err);
      const item = {
        file,
        nomeOriginal: file.name,
        nomeExtraido: "",
        senha: "",
        proteger: false,
        aprovado: false,
        novoNome: "",
        erro: true,
      };
      estado.arquivos.push(item);
      adicionarLinhaTabela(item);
    }

    processados++;
    atualizarProgresso(processados, total);
  }

  setTimeout(() => {
    progressoContainer.classList.add("oculto");
  }, 800);

  atualizarInfoDownload();
}

function atualizarProgresso(atual, total) {
  const pct = total ? (atual / total) * 100 : 0;
  progressoBarra.style.width = pct + "%";
  progressoTexto.textContent = `${atual}/${total}`;
}

// ============================================
// Tabela
// ============================================
function adicionarLinhaTabela(item) {
  const tr = document.createElement("tr");
  item._tr = tr;

  tr.innerHTML = `
    <td class="col-check">
      <input type="checkbox" class="check-aprovado" ${item.aprovado ? "checked" : ""}>
    </td>
    <td class="col-lock">
      <input type="checkbox" class="check-proteger" ${item.proteger ? "checked" : ""}
             title="Aplicar senha neste arquivo">
    </td>
    <td>${escaparHtml(item.nomeOriginal)}</td>
    <td>
      <input type="text" value="${escaparHtml(item.nomeExtraido)}"
             placeholder="Nome não encontrado">
    </td>
    <td class="celula-novo"></td>
    <td>
      <input type="text" class="senha-input" value="${escaparHtml(item.senha)}"
             placeholder="CPF sem pontos/traços" disabled>
    </td>
  `;

  const checkAprovado = tr.querySelector(".check-aprovado");
  const checkProteger = tr.querySelector(".check-proteger");
  const inputNome = tr.querySelector('input[type="text"]:not(.senha-input)');
  const inputSenha = tr.querySelector(".senha-input");

  checkAprovado.addEventListener("change", () => {
    item.aprovado = checkAprovado.checked;
  });

  checkProteger.addEventListener("change", () => {
    item.proteger = checkProteger.checked;
    aplicarEstadoProtecao(item);
    atualizarInfoDownload();
  });

  inputNome.addEventListener("input", () => {
    item.nomeExtraido = inputNome.value;
    atualizarNovoNomeItem(item);
  });

  inputSenha.addEventListener("input", () => {
    const limpo = soDigitos(inputSenha.value);
    if (limpo !== inputSenha.value) inputSenha.value = limpo;
    item.senha = limpo;
    atualizarEstadoSenha(item);
  });

  item._inputNome = inputNome;
  item._inputSenha = inputSenha;
  item._checkProteger = checkProteger;

  tabelaCorpo.appendChild(tr);
  aplicarEstadoProtecao(item);
  atualizarEstadoSenha(item);
}

// Quando marcar/desmarcar 🔒, habilita/desabilita o campo de senha
function aplicarEstadoProtecao(item) {
  const tr = item._tr;
  const inputSenha = item._inputSenha;

  if (item.proteger) {
    tr.classList.add("linha-protegida");
    inputSenha.disabled = false;
    inputSenha.classList.remove("senha-desabilitada");
  } else {
    tr.classList.remove("linha-protegida");
    inputSenha.disabled = true;
    inputSenha.classList.add("senha-desabilitada");
  }
}

function atualizarEstadoSenha(item) {
  if (!item._inputSenha) return;
  const el = item._inputSenha;
  el.classList.remove("senha-vazia", "senha-valida");

  if (!item.proteger) return; // só valida visualmente se estiver protegido

  if (!item.senha) {
    el.classList.add("senha-vazia");
  } else if (item.senha.length === 11) {
    el.classList.add("senha-valida");
  }
}

function atualizarNovoNomeItem(item) {
  const celulaNovo = item._tr.querySelector(".celula-novo");
  const nomeBase = (item.nomeExtraido || "").trim();

  if (!nomeBase) {
    celulaNovo.innerHTML = '<span class="sem-nome">sem nome</span>';
    item.novoNome = "";
    return;
  }

  const prefixo = sanitizarNome(estado.prefixo || "");
  const sufixo = sanitizarNome(estado.sufixo || "");
  const base
