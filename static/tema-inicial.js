// Aplica o tema salvo antes de a página ser desenhada, para a tela não piscar clara no F5.
try {
    var temaSalvo = localStorage.getItem('wms.tema') === 'escuro' ? 'escuro' : 'claro';
    document.documentElement.setAttribute('data-tema', temaSalvo);
    document.documentElement.setAttribute('data-bs-theme', temaSalvo === 'escuro' ? 'dark' : 'light');
} catch (e) { /* sem localStorage: abre no claro */ }
