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
// Extração
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
  console.log("   texto (início):", texto.slice(0, 300));
  return texto;
}

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
const btnLimpar = document.getElementById("limpar");

// ✅ NOVO: campos de prefixo/sufixo
const inputPrefixo = document.getElementById("prefixo");
const inputSufixo = document.getElementById("sufixo");
const btnLimparAfixos = document.getElementById("limpar-afixos");

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
  console.log("📁 Arquivos selecionados:", e.target.files.length);
  const arquivos = Array.from(e.target.files);
  if (arquivos.length) processarArquivos(arquivos);
  inputArquivos.value = "";
});

// ✅ NOVO: listeners dos afixos
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
      console.log("   nome extraído:", nome || "(vazio)");

      const item = {
        file,
        nomeOriginal: file.name,
        nomeExtraido: nome,
        aprovado: !!nome,
        novoNome: "",       // recalculado abaixo
      };
      estado.arquivos.push(item);
      adicionarLinhaTabela(item);
      atualizarNovoNomeItem(item);   // ✅ aplica prefixo/sufixo atuais
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
// Tabela
// ============================================
function adicionarLinhaTabela(item) {
  const tr = document.createElement("tr");
  item._tr = tr;   // ✅ guarda referência para atualizar depois

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

  checkbox.addEventListener("change", () => {
    item.aprovado = checkbox.checked;
  });

  inputNome.addEventListener("input", () => {
    item.nomeExtraido = inputNome.value;
    atualizarNovoNomeItem(item);
  });

  item._inputNome = inputNome;   // ✅ guarda referência

  tabelaCorpo.appendChild(tr);
}

// ============================================
// ✅ NOVO: cálculo do novo nome com prefixo/sufixo
// ============================================
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
  const base = sanitizarNome(nomeBase);

  // monta: [prefixo ][BASE][ sufixo].pdf
  let final = base;
  if (prefixo) final = prefixo + " " + final;
  if (sufixo) final = final + " " + sufixo;

  final = final.replace(/\s+/g, " ").trim();

  item.novoNome = final + ".pdf";
  celulaNovo.textContent = item.novoNome;
}

function reconstruirTodosNovosNomes() {
  estado.arquivos.forEach(item => {
    if (item._tr) atualizarNovoNomeItem(item);
  });
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
  estado.arquivos.forEach(item => {
    const cb = item._tr.querySelector('input[type="checkbox"]');
    cb.checked = item.aprovado;
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
