// ============================================
// Configuração do pdf.js
// ============================================
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.js";

// ============================================
// Padrões de extração do nome (mesma lógica do Python)
// ============================================
const PADROES_NOME = [
  // "Declaro que NOME ..."
  /[Dd]eclaro(?:\s+para\s+os\s+devidos\s+fins)?,?\s+que\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-ú]+){1,5})/,
  // "eu, NOME, ..."
  /\beu,?\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-ú]+){1,5})/,
  // "Nome: NOME" / "Nome completo: NOME"
  /Nome(?:\s+completo)?[:\-]\s*([A-ZÀ-Ú][^\n]{3,60})/,
  // "Declarante NOME"
  /[Dd]eclarante[:\-]?\s+([A-ZÀ-Ú][^\n]{3,60})/,
  // Nome logo acima do CPF (assinatura)
  /([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-ú]+){1,5})\s*\n\s*CPF[:\s]*\d{3}\.\d{3}\.\d{3}-\d{2}/,
];

const PALAVRAS_PROIBIDAS = new Set([
  "Declaração", "Declaro", "Brasil", "República", "Federativa",
  "Ministério", "Secretaria", "Estado", "Município", "Prefeitura",
  "Universidade", "Escola", "Certidão", "Declarante",
]);

// ============================================
// Funções de extração
// ============================================
async function lerPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let texto = "";
  const totalPaginas = Math.min(pdf.numPages, 5); // só as 5 primeiras
  for (let i = 1; i <= totalPaginas; i++) {
    const pagina = await pdf.getPage(i);
    const conteudo = await pagina.getTextContent();
    texto += conteudo.items.map(item => item.str).join(" ") + "\n";
  }
  return texto;
}

function nomeValido(nome) {
  if (!nome) return false;
  const n = nome.trim();
  if (n.length < 5 || n.length > 80) return false;

  const partes = n.split(/\s+/);
  if (partes.length < 2) return false;

  if (partes.some(p => PALAVRAS_PROIBIDAS.has(p))) return false;
  if (/\d/.test(n)) return false;

  return true;
}

function extrairNome(texto) {
  const textoNorm = texto.replace(/[ \t]+/g, " ");

  for (const padrao of PADROES_NOME) {
    const matches = textoNorm.matchAll(new RegExp(padrao, "g"));
    for (const m of matches) {
      const nome = m[1].replace(/\s+/g, " ").trim();
      if (nomeValido(nome)) return nome;
    }
  }

  // Fallback: nome na assinatura (últimas linhas)
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
    .replace(/[\u0300-\u036f]/g, "")   // remove acentos
    .replace(/[^\w\s\-]/g, "")         // só letras/números/espaço/hífen
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase()) // Title Case
    .slice(0, 80);
}

// ============================================
// Estado da aplicação
// ============================================
const estado = {
  arquivos: [], // { file, nomeOriginal, nomeExtraido, aprovado, novoNome }
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
const btnLimpar = document.getElementById("limpar");

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
  inputArquivos.value = ""; // permite re-selecionar os mesmos
});

// ============================================
// Processamento em lote
// ============================================
async function processarArquivos(arquivos) {
  progressoContainer.classList.remove("oculto");
  tabelaContainer.classList.remove("oculto");

  let processados = 0;
  const total = arquivos.length;
  atualizarProgresso(0, total);

  for (const file of arquivos) {
    try {
      const texto = await lerPdf(file);
      const nome = extrairNome(texto);

      const item = {
        file,
        nomeOriginal: file.name,
        nomeExtraido: nome,
        aprovado: !!nome,
        novoNome: nome ? sanitizarNome(nome) + ".pdf" : "",
      };
      estado.arquivos.push(item);
      adicionarLinhaTabela(item);
    } catch (err) {
      console.error("Erro ao ler", file.name, err);
      const item = {
        file,
        nomeOriginal: file.name,
        nomeExtraido: "",
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
}

function atualizarProgresso(atual, total) {
  const pct = total ? (atual / total) * 100 : 0;
  progressoBarra.style.width = pct + "%";
  progressoTexto.textContent = `${atual}/${total}`;
}

// ============================================
// Renderização da tabela
// ============================================
function adicionarLinhaTabela(item) {
  const tr = document.createElement("tr");
  const idx = estado.arquivos.indexOf(item);

  tr.innerHTML = `
    <td class="col-check">
      <input type="checkbox" ${item.aprovado ? "checked" : ""}>
    </td>
    <td>${escaparHtml(item.nomeOriginal)}</td>
    <td>
      <input type="text" value="${escaparHtml(item.nomeExtraido)}"
             placeholder="Nome não encontrado">
    </td>
    <td class="celula-novo"></td>
  `;

  const checkbox = tr.querySelector('input[type="checkbox"]');
  const inputNome = tr.querySelector('input[type="text"]');
  const celulaNovo = tr.querySelector(".celula-novo");

  const atualizarCelulaNovo = () => {
    if (!inputNome.value.trim()) {
      celulaNovo.innerHTML = '<span class="sem-nome">sem nome</span>';
      item.novoNome = "";
      return;
    }
    const s = sanitizarNome(inputNome.value);
    item.novoNome = s + ".pdf";
    celulaNovo.textContent = item.novoNome;
  };

  checkbox.addEventListener("change", () => {
    item.aprovado = checkbox.checked;
  });

  inputNome.addEventListener("input", () => {
    item.nomeExtraido = inputNome.value;
    atualizarCelulaNovo();
  });

  atualizarCelulaNovo();
  tabelaCorpo.appendChild(tr);
}

function escaparHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================
// Ações em massa
// ============================================
btnAprovarTodos.addEventListener("click", () => {
  estado.arquivos.forEach(item => {
    if (item.novoNome) item.aprovado = true;
  });
  sincronizarCheckboxes();
});

btnDesmarcarTodos.addEventListener("click", () => {
  estado.arquivos.forEach(item => item.aprovado = false);
  sincronizarCheckboxes();
});

function sincronizarCheckboxes() {
  const linhas = tabelaCorpo.querySelectorAll("tr");
  linhas.forEach((tr, i) => {
    const cb = tr.querySelector('input[type="checkbox"]');
    cb.checked = estado.arquivos[i].aprovado;
  });
}

btnLimpar.addEventListener("click", () => {
  estado.arquivos = [];
  tabelaCorpo.innerHTML = "";
  tabelaContainer.classList.add("oculto");
  progressoContainer.classList.add("oculto");
});

// ============================================
// Download em .zip
// ============================================
btnBaixarZip.addEventListener("click", async () => {
  const aprovados = estado.arquivos.filter(
    item => item.aprovado && item.novoNome
  );

  if (!aprovados.length) {
    alert("Nenhum arquivo marcado com nome válido.");
    return;
  }

  btnBaixarZip.disabled = true;
  btnBaixarZip.textContent = "Gerando .zip...";

  const zip = new JSZip();
  const usados = new Set();

  for (const item of aprovados) {
    let nomeFinal = item.novoNome;
    let contador = 2;
    while (usados.has(nomeFinal)) {
      const base = nomeFinal.replace(/\.pdf$/i, "");
      nomeFinal = `${base}_${contador}.pdf`;
      contador++;
    }
    usados.add(nomeFinal);

    const buffer = await item.file.arrayBuffer();
    zip.file(nomeFinal, buffer);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "declaracoes-renomeadas.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  btnBaixarZip.disabled = false;
  btnBaixarZip.textContent = "📦 Baixar renomeados (.zip)";
});
