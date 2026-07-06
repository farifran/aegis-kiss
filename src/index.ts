export function soma(a: number, b: number): number {
    return a + b;
}
export function subtracao(a: number, b: number): number {
    return a - b;
}
export function multiplicacao(a: number, b: number): number {
    return a * b;
}
export function potencia(base: number, expoente: number): number {
    return base ** expoente;
}
export function quadratica(a: number, b: number, c: number, x: number): number {
    return a * x ** 2 + b * x + c;
}
export function primeiro_grau(a: number, b: number, x: number): number {
    return a * x + b;
}
export function celsiusParaFahrenheit(celsius: number): number {
    return (celsius * 9) / 5 + 32;
}
export function fahrenheitParaCelsius(fahrenheit: number): number {
    return ((fahrenheit - 32) * 5) / 9;
}
export function metrosParaCentimetros(metros: number): number {
    return metros * 100;
}
export function centimetrosParaMetros(centimetros: number): number {
    return centimetros / 100;
}
export function minutosParaSegundos(minutos: number): number {
    return minutos * 60;
}
export function kilosParaLibras(kilos: number): number {
    return kilos * 2.20462;
}
export function librasParaKilos(libras: number): number {
    return libras / 2.20462;
}
