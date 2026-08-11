// 例文セット(MVP: コード内データ配列で管理)
// 各単語: { text, type: 'content' | 'function', ipaStrong, ipaWeak(あれば), note(あれば) }
const SENTENCES = [
  {
    id: "s01",
    text: "I can speak English.",
    words: [
      { text: "I", type: "function" },
      { text: "can", type: "function", ipaStrong: "kæn", ipaWeak: "kən", note: "強調しない限り弱形/kən/が標準" },
      { text: "speak", type: "content" },
      { text: "English.", type: "content" }
    ]
  },
  {
    id: "s02",
    text: "She was reading a book.",
    words: [
      { text: "She", type: "function" },
      { text: "was", type: "function", ipaStrong: "wɒz", ipaWeak: "wəz" },
      { text: "reading", type: "content" },
      { text: "a", type: "function", ipaStrong: "eɪ", ipaWeak: "ə" },
      { text: "book.", type: "content" }
    ]
  },
  {
    id: "s03",
    text: "This is for you.",
    words: [
      { text: "This", type: "content", note: "指示代名詞として強く読まれる" },
      { text: "is", type: "function", ipaStrong: "ɪz", ipaWeak: "z" },
      { text: "for", type: "function", ipaStrong: "fɔːr", ipaWeak: "fər" },
      { text: "you.", type: "function", ipaStrong: "juː", ipaWeak: "jə" }
    ]
  },
  {
    id: "s04",
    text: "We are waiting for the bus.",
    words: [
      { text: "We", type: "function" },
      { text: "are", type: "function", ipaStrong: "ɑːr", ipaWeak: "ər" },
      { text: "waiting", type: "content" },
      { text: "for", type: "function", ipaStrong: "fɔːr", ipaWeak: "fər" },
      { text: "the", type: "function", ipaStrong: "ðiː", ipaWeak: "ðə" },
      { text: "bus.", type: "content" }
    ]
  },
  {
    id: "s05",
    text: "He has finished his homework.",
    words: [
      { text: "He", type: "function" },
      { text: "has", type: "function", ipaStrong: "hæz", ipaWeak: "həz" },
      { text: "finished", type: "content" },
      { text: "his", type: "function", ipaStrong: "hɪz", ipaWeak: "ɪz" },
      { text: "homework.", type: "content" }
    ]
  },
  {
    id: "s06",
    text: "They will arrive at seven.",
    words: [
      { text: "They", type: "function" },
      { text: "will", type: "function", ipaStrong: "wɪl", ipaWeak: "əl" },
      { text: "arrive", type: "content" },
      { text: "at", type: "function", ipaStrong: "æt", ipaWeak: "ət" },
      { text: "seven.", type: "content" }
    ]
  },
  {
    id: "s07",
    text: "You should call your teacher.",
    words: [
      { text: "You", type: "function", ipaStrong: "juː", ipaWeak: "jə" },
      { text: "should", type: "function", ipaStrong: "ʃʊd", ipaWeak: "ʃəd" },
      { text: "call", type: "content" },
      { text: "your", type: "function", ipaStrong: "jʊər", ipaWeak: "jər" },
      { text: "teacher.", type: "content" }
    ]
  },
  {
    id: "s08",
    text: "We must finish the project.",
    words: [
      { text: "We", type: "function" },
      { text: "must", type: "function", ipaStrong: "mʌst", ipaWeak: "məst" },
      { text: "finish", type: "content" },
      { text: "the", type: "function", ipaStrong: "ðiː", ipaWeak: "ðə" },
      { text: "project.", type: "content" }
    ]
  },
  {
    id: "s09",
    text: "I would like some coffee.",
    words: [
      { text: "I", type: "function" },
      { text: "would", type: "function", ipaStrong: "wʊd", ipaWeak: "wəd" },
      { text: "like", type: "content" },
      { text: "some", type: "function", ipaStrong: "sʌm", ipaWeak: "səm" },
      { text: "coffee.", type: "content" }
    ]
  },
  {
    id: "s10",
    text: "She can play the piano.",
    words: [
      { text: "She", type: "function" },
      { text: "can", type: "function", ipaStrong: "kæn", ipaWeak: "kən" },
      { text: "play", type: "content" },
      { text: "the", type: "function", ipaStrong: "ðiː", ipaWeak: "ðə" },
      { text: "piano.", type: "content" }
    ]
  },
  {
    id: "s11",
    text: "He gave the book to Mary.",
    words: [
      { text: "He", type: "function" },
      { text: "gave", type: "content" },
      { text: "the", type: "function", ipaStrong: "ðiː", ipaWeak: "ðə" },
      { text: "book", type: "content" },
      { text: "to", type: "function", ipaStrong: "tuː", ipaWeak: "tə" },
      { text: "Mary.", type: "content" }
    ]
  },
  {
    id: "s12",
    text: "There were many students in the room.",
    words: [
      { text: "There", type: "function", ipaStrong: "ðɛər", ipaWeak: "ðər", note: "存在のthereは弱形になりやすい" },
      { text: "were", type: "function", ipaStrong: "wɜːr", ipaWeak: "wər" },
      { text: "many", type: "content" },
      { text: "students", type: "content" },
      { text: "in", type: "function" },
      { text: "the", type: "function", ipaStrong: "ðiː", ipaWeak: "ðə" },
      { text: "room.", type: "content" }
    ]
  },
  {
    id: "s13",
    text: "I have to go now.",
    words: [
      { text: "I", type: "function" },
      { text: "have", type: "function", ipaStrong: "hæv", ipaWeak: "həv" },
      { text: "to", type: "function", ipaStrong: "tuː", ipaWeak: "tə" },
      { text: "go", type: "content" },
      { text: "now.", type: "content" }
    ]
  },
  {
    id: "s14",
    text: "Can you help me for a minute?",
    words: [
      { text: "Can", type: "function", ipaStrong: "kæn", ipaWeak: "kən" },
      { text: "you", type: "function", ipaStrong: "juː", ipaWeak: "jə" },
      { text: "help", type: "content" },
      { text: "me", type: "function", ipaStrong: "miː", ipaWeak: "mi" },
      { text: "for", type: "function", ipaStrong: "fɔːr", ipaWeak: "fər" },
      { text: "a", type: "function", ipaStrong: "eɪ", ipaWeak: "ə" },
      { text: "minute?", type: "content" }
    ]
  },
  {
    id: "s15",
    text: "The students were waiting for their results.",
    words: [
      { text: "The", type: "function", ipaStrong: "ðiː", ipaWeak: "ðə" },
      { text: "students", type: "content" },
      { text: "were", type: "function", ipaStrong: "wɜːr", ipaWeak: "wər" },
      { text: "waiting", type: "content" },
      { text: "for", type: "function", ipaStrong: "fɔːr", ipaWeak: "fər" },
      { text: "their", type: "function", ipaStrong: "ðɛər", ipaWeak: "ðər" },
      { text: "results.", type: "content" }
    ]
  }
];
