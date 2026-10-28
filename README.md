# asistan — Claude Code için Türkçe asistan paneli

Claude Code oturumunun yanına sabit bir panel ekleyen bir mod. Anahtarlarını ve
paketlerini korur, Türkçe promptlarını İngilizceye çevirip iyileştirir (cevap
yine Türkçe gelir), maliyetini ve verimliliğini takip eder, değişen dosyaları
ve testleri tek yerde gösterir.

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

## Neler var

**Panel** (terminal 144 sütun ve üstündeyse kendiliğinden açılır, değilse `/asistan`).
Sekmeler arasında `1`–`6` ile geçilir:

1. **Özet** — verimlilik skoru (0–100), cache/context/hata oranı, kullanım
   limitleri, oturum/gün/proje maliyeti, 7 günlük grafik, proje bazında
   harcama, görev listesi, test durumu, Türkçe tur özeti, çalışan alt ajanlar,
   haftalık rapor, öneriler.
2. **Prompt** — iyileştirilen promptun kalite puanı, eksikleri ve eklenenler;
   yazdığın / gönderilen (EN) / Türkçesi; aranabilir geçmiş; şablonlar.
3. **Güvenlik** — `.env` dosyaları git'te mi, `.gitignore`'da mı; korumalar;
   paket kontrolü sonuçları; erişilen alan adları; olay günlüğü.
4. **Kod** — bu oturumda değişen dosyalar, diff'leri ve tek tıkla geri alma;
   testler; son hata ve Türkçe açıklaması; commit mesajı önerisi; son cevaptaki
   kod bloklarını kopyalama.
5. **Sözlük** — cevaplarda geçen İngilizce teknik terimler ve Türkçe karşılıkları.
6. **Ayarlar** — bildirim, ses, sesli özet, tur özeti, sözlük, model önerisi,
   otomatik test, günlük ve proje bütçesi.

**Prompt iyileştirme**

- `++` ile başlayan prompt İngilizceye çevrilip netleştirilir ve öyle gönderilir;
  Claude'a Türkçe cevap vermesi ve orijinal metnin de iletilir.
- Prompt kutusunun üstündeki **✨ İyileştir** düğmesi taslağı İngilizce sürümle
  değiştirir; bakıp Enter'a basarsın.
- `/prompt-modu her-zaman` ile her prompt iyileştirilir.

**Güvenlik**

- Prompt kutusuna yapıştırılan anahtar yazarken kırmızıya boyanır; gönderirken
  uyarır, maskeler ya da engeller (`/anahtar-koruma`).
- Araç çıktılarındaki anahtarlar ve `.env` değerleri model görmeden `[GİZLİ]` olur.
- `git add` / `git commit` hassas dosya ya da anahtar içeriyorsa durdurulur.
- İsteğe bağlı: `.env`, SSH anahtarları, `.pem`, bulut kimlik bilgileri gibi
  hassas dosyalara erişim tamamen kapatılabilir.
- `npm/pnpm/yarn/bun/pip/uv/poetry` ile kurulan paketler kayıt defterinde
  kontrol edilir: olmayan (uydurulmuş) ya da popüler bir pakete çok benzeyen
  yeni/az kullanılan paketler durdurulur.
- Riskli komutlarda (`rm -rf`, `git push --force` …) uyarır, yeni alan adlarına
  erişimi bildirir.

**Komutlar**

| Komut | Ne yapar |
| --- | --- |
| `/asistan` | Paneli açar |
| `/iyilestir <metin>` | Metni iyileştirip kutuya yazar |
| `/prompt-modu [onek\|her-zaman]` | Ne zaman iyileştirileceği |
| `/anahtar-koruma [uyar\|maskele\|engelle]` | Promptta anahtar bulununca |
| `/guvenlik` | `.env` taramasını yeniler |
| `/ozet` | Oturum özeti |
| `/rapor` | Son 7 günün raporu |
| `/sablon [<ad>\|kaydet <ad> [metin]\|sil <ad>]` | Prompt şablonları |
| `/butce [<dolar>\|kapat\|uyar\|durdur\|proje <dolar>]` | Günlük ve proje bütçesi |
| `/test-komutu [<komut>\|sil]` | Projenin test komutu (boşsa otomatik bulunur) |

## Bilmen gerekenler

- İyileştirme, tur özeti/sözlük, hata açıklaması ve commit önerisi küçük birer
  Haiku çağrısı yapar ve oturumun kimlik bilgileriyle faturalanır; Ayarlar'dan
  kapatılabilir.
- Masaüstü bildirimi `notify-send`, ses `paplay` ile çalışır (Linux); yoksa
  Claude Code'un kendi bildirimi kullanılır.
- Paket kontrolü npm/PyPI'ya istek atar; ağ yoksa kurulum engellenmez.
- Değişen dosyaların "geri al" düğmesi, dosyanın bu oturumdaki ilk
  düzenlemeden önceki halini yazar. Mod yeniden yüklenirse bu anlık görüntüler
  kaybolur ve diff git'ten alınır.
- Mod API'si erken erişimdedir; Claude Code sürümleri arasında değişebilir.

## Geliştirme

```
claude --plugin-dir ./ 
claude plugin validate ./
claude plugin test ./
```

Lisans: MIT
