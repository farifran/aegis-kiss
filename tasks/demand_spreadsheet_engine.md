Preciso de um motor de planilha em memória, sem interface gráfica e sem persistência, que entenda fórmulas e mantenha todos os valores coerentes a qualquer momento. Quero as três responsabilidades em módulos separados: a análise de fórmulas em src/formulaParser.ts, o grafo de dependências em src/dependencyGraph.ts e a planilha em src/spreadsheet.ts, todos re-exportados por src/index.ts.

Endereçamento e conteúdo. Uma célula é endereçada no formato coluna seguida de linha, como A1 ou BC27, com colunas indo de A até ZZ e linhas começando em 1. Uma célula pode guardar um número, um texto, ou uma fórmula, que é qualquer conteúdo começando por sinal de igual. Célula nunca gravada está vazia, e vazio é diferente de zero e de texto em branco.

Fórmulas. Uma fórmula combina referências a outras células, números literais, os quatro operadores aritméticos com a precedência usual, parênteses para agrupar, e as funções SOMA, MEDIA, MINIMO, MAXIMO e CONTAR aplicadas a um intervalo retangular escrito como A1:B3. Fórmula malformada é recusada no momento da gravação com um erro que diga o que está errado, e o conteúdo anterior da célula permanece intacto.

Recálculo. Ao gravar uma célula, toda célula que dependa dela, direta ou indiretamente, precisa refletir o novo valor imediatamente. Cada célula afetada é recalculada exatamente uma vez por gravação, na ordem em que suas próprias dependências ficam prontas. Célula vazia referenciada em aritmética vale zero, referenciada por CONTAR não é contada, e referenciada por MEDIA não entra no divisor.

Erros não derrubam a planilha. Divisão por zero, endereço fora do formato, texto usado em aritmética e ciclo de dependências produzem valores de erro distintos e identificáveis. Um erro se propaga para todas as células que dependem dele preservando qual foi o erro original: quem depende de uma divisão por zero mostra divisão por zero, não um erro genérico.

Ciclos. Um ciclo precisa ser detectado no momento da gravação, não durante o cálculo. A gravação que criaria o ciclo é recusada e a planilha continua exatamente no estado anterior, sem nenhuma célula parcialmente atualizada e sem nenhum recálculo disparado.

Consultas. Quero poder ler o valor calculado de uma célula, a fórmula original que foi digitada, a lista de endereços que dependem diretamente de um endereço dado, e quantos recálculos a última gravação disparou.
