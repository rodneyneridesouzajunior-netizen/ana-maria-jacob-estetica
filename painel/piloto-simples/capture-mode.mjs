// A captura dedicada oculta somente a barra externa; a rolagem continua disponível.
document.documentElement.classList.toggle('capture-fullhd',new URLSearchParams(location.search).get('capture')==='fullhd');
document.documentElement.classList.toggle('capture-4k',new URLSearchParams(location.search).get('capture')==='4k');
