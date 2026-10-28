# asistan — Claude Code için yan panel

[English](README.md)

Claude Code oturumunun yanına sabit bir panel ekleyen bir mod. Anahtarlarını,
bağımlılıklarını ve git geçmişini korur, promptlarını net bir İngilizceye
çevirip iyileştirir (cevap yine senin dilinde gelir), maliyetini ve
verimliliğini takip eder; değişen dosyaları, testleri, zaman çizelgesini ve
terim sözlüğünü tek yerde toplar. Arayüz Türkçe ve İngilizce (`/dil en`).

## Kurulum

Claude Code terminal oturumunda:

```
/plugin install asistan --marketplace ipeq32/claude-asistan
```

Pazaryerini eklemek için `y`, ardından kapsam olarak `user` seç. Kabuktan:

```
claude plugin install asistan --marketplace ipeq32/claude-asistan
```

Masaüstü uygulamasında: istem kutusunun yanındaki + → Plugins → Add marketplace
(`ipeq32/claude-asistan`) → Add plugin.

## Panel

Terminal 144 sütun ve üstündeyse kendiliğinden açılır, değilse `/asistan`.
Panel klavyeyi tutarken `1`–`7` sekmeler arasında geçer.

1. **Özet** — verimlilik skoru (0–100) ve 14 günlük eğilimi, cache / context /
   hata oranı, kullanım limitleri, oturum / gün / proje maliyeti, 7 günlük
   grafik, proje bazında harcama, görevler, test durumu, son turun özeti,
   çalışan alt ajanlar, haftalık rapor, öneriler.
2. **Prompt** — iyileştirilen promptun kalite puanı, eksikleri ve eklenenler;
   yazdığın / gönderilen / Türkçesi; aranabilir geçmiş; kişisel ve ekip şablonları.
3. **Güvenlik** — `.env` dosyaları git'te mi, ignore'da mı; tüm korumaların
   anahtarları; bağımlılık açıkları (OSV); git geçmişinde anahtar; kontrol
   edilen paketler; erişilen alan adları; olay günlüğü.
4. **Kod** — bu oturumda değişen dosyalar, diff'leri ve tek tıkla geri alma;
   testler; son hata ve açıklaması; commit mesajı önerisi; son cevaptaki kod
   bloklarını kopyalama.
5. **Zaman** — en yavaş araç çağrıları, son çağrılar ve süreleri, en pahalı turlar.
6. **Sözlük** — cevaplarda geçen İngilizce teknik terimler ve açıklamaları.
7. **Ayarlar** — dil, asistanın kendi modeli (Haiku ya da yerel Ollama modeli),
   bildirimler (masaüstü, ses, sesli okuma, Telegram / Discord), her özelliğin
   anahtarı, günlük ve proje bütçesi, dışa / içe aktarma.

## Prompt iyileştirme

- `++` ile başlayan prompt net bir İngilizce prompta çevrilip öyle gönderilir;
  Claude'dan senin yazdığın dilde cevap vermesi istenir.
- Kutunun üstündeki **✨ İyileştir** taslağı iyileştirilmiş sürümle değiştirir;
  okuyup Enter'a basarsın.
- `/prompt-modu her-zaman` ile her prompt iyileştirilir.
- Yazarken şerit, taslağın yaklaşık kaç token olduğunu ve bir turun ortalama
  maliyetini gösterir.

## Korumalar

- Kutuya yapıştırılan anahtar yazarken kırmızıya boyanır; gönderirken uyarır,
  maskeler ya da engeller (`/anahtar-koruma`).
- Araç çıktılarındaki anahtarlar ve `.env` değerleri model görmeden maskelenir.
- `git add` / `commit` / `push`, hassas dosya ya da anahtar ekleyecek ya da
  yayınlayacaksa durdurulur.
- İsteğe bağlı: `.env`, SSH anahtarları, `.pem`, bulut kimlik bilgileri gibi
  dosyalara erişim tamamen kapatılabilir.
- `npm / pnpm / yarn / bun / pip / uv / poetry` ile kurulan paketler önce
  sorgulanır: hiç olmayan (çoğu zaman modelin uydurduğu) ya da popüler bir
  pakete çok benzeyen yeni / az kullanılan paketler durdurulur; bilinen açığı
  olan sürüm, düzeltilmiş sürümüyle birlikte bildirilir.
- `/zafiyet` sürümü sabit tüm bağımlılıkları (`package-lock.json`,
  `requirements.txt`) OSV'ye sorar; `/gecmis-tara` bütün git geçmişinde
  sızmış anahtar arar.
- Riskli komutlar (`rm -rf`, `git push --force` …) ve yeni alan adları bildirilir.
- Her turdan sonra yapılanlar projenin `CLAUDE.md` kurallarıyla karşılaştırılır;
  CLAUDE.md'si olmayan projede `/init` önerilir.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `/asistan` | Paneli açar |
| `/iyilestir <metin>` | Metni iyileştirip kutuya yazar |
| `/prompt-modu [onek\|her-zaman]` | Ne zaman iyileştirileceği |
| `/anahtar-koruma [uyar\|maskele\|engelle]` | Promptta anahtar bulununca |
| `/guvenlik` | `.env` taramasını yeniler |
| `/zafiyet` | Bağımlılıkları bilinen açıklara karşı tarar |
| `/gecmis-tara` | Git geçmişinde anahtar arar |
| `/ozet` | Oturum özeti |
| `/rapor` | Son 7 günün raporu |
| `/sablon [<ad>\|kaydet\|sil\|paylas]` | Şablonlar; `paylas` ekip için `.asistan/sablonlar.json` yazar |
| `/butce [<dolar>\|kapat\|uyar\|durdur\|proje <dolar>]` | Günlük ve proje bütçesi |
| `/test-komutu [<komut>\|sil]` | Projenin test komutu |
| `/bildirim [test\|ac\|kapat]` | Telegram / Discord bildirimi |
| `/ayar-aktar [disa\|ice] [yol]` | Ayarlar, şablonlar ve sözlük dosyaya / dosyadan |
| `/dil [tr\|en]` | Arayüz dili |

## Telefona bildirim

Kurulumda (ya da eklenti ayarlarında) `telegramBotToken` + `telegramChatId`
veya `discordWebhookUrl` alanlarını doldur; ya da `ASISTAN_TELEGRAM_TOKEN`,
`ASISTAN_TELEGRAM_CHAT_ID`, `ASISTAN_DISCORD_WEBHOOK` ortam değişkenlerini
tanımla. Sonra `/bildirim ac` ve `/bildirim test`.

## Bilmen gerekenler

- İyileştirme, tur özeti, hata açıklaması, commit önerisi ve model önerisi
  birer küçük model çağrısıdır ve oturumun kimlik bilgileriyle faturalanır.
  Ayarlar'dan yerel bir Ollama modeli seçilirse bunlar bilgisayardan çıkmaz;
  yerel çağrı başarısız olursa Haiku'ya geçilmez.
- Paket, açık ve geçmiş kontrolleri npm, PyPI ve OSV'ye istek atar; ağ yoksa
  kurulum durdurulmaz.
- Geri alma, dosyayı bu oturumdaki ilk düzenlemeden önceki haline yazar. Mod
  yeniden yüklenirse bu anlık görüntüler kaybolur; diff git'ten alınır.
- Masaüstü bildirimi `notify-send`, ses `paplay` ile çalışır (Linux); yoksa
  Claude Code'un kendi bildirimi kullanılır.
- Mod API'si erken erişimdedir; Claude Code sürümleri arasında değişebilir.

## Geliştirme

```
claude --plugin-dir ./
claude plugin validate ./
claude plugin test ./
```

Değişiklikler [CHANGELOG.md](CHANGELOG.md) dosyasında. Lisans: MIT.
