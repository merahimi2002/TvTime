
document.addEventListener("DOMContentLoaded", function () {
    const button = document.querySelector('.first-button');
    button.addEventListener('click', function () {
        const icon = this.querySelector('.animated-icon1');
        icon.classList.toggle('open');
    });
});

// change color

const toggleTheme = document.getElementById('ThemeBoxSwitchInput');

toggleTheme.addEventListener('change', function () {
    const root = document.documentElement;

    if (this.checked) {
        // DarkMode
        root.style.setProperty('--white-custome', '0, 0, 0');
        root.style.setProperty('--black-custome', '255, 255, 255');

    } else {
        // Light Mode
        root.style.setProperty('--white-custome', '255, 255, 255');
        root.style.setProperty('--black-custome', '0, 0, 0');
    }
});


function changeColor() {
    const root = document.documentElement;
    root.style.setProperty('--first-color', '0, 216, 235');
    root.style.setProperty('--second-color', '46, 77, 114');
}

function changeColor01() {
    const root = document.documentElement;
    root.style.setProperty('--first-color', '34, 154, 149');
    root.style.setProperty('--second-color', '255, 162, 0');
}

// CustomColorPicker

const firstInput = document.getElementById('firstColorInput');
const secondInput = document.getElementById('secondColorInput');

function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
    }
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
}

firstInput.addEventListener('input', () => {
    const rgb = hexToRgb(firstInput.value);
    document.documentElement.style.setProperty('--first-color', rgb);
});

secondInput.addEventListener('input', () => {
    const rgb = hexToRgb(secondInput.value);
    document.documentElement.style.setProperty('--second-color', rgb);
});


