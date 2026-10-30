import com.scamshield.model.*;
import com.scamshield.service.ScamAnalysisService;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Parity harness: analyzes every case in a TSV file with the Java engine and prints one canonical
 * line per case. parity.mjs prints the same format from the JavaScript port and diffs the two.
 * Run: java -cp target/scamshield-1.1.0.jar extension-tests/Harness.java cases.tsv
 */
public class Harness {
    public static void main(String[] args) throws IOException {
        ScamAnalysisService service = new ScamAnalysisService();
        StringBuilder out = new StringBuilder();
        for (String line : Files.readAllLines(Path.of(args[0]), StandardCharsets.UTF_8)) {
            if (line.isEmpty()) continue;
            String[] f = line.split("\t", -1);
            MessageSource source = MessageSource.valueOf(f[0]);
            String a = unescape(f[1]), b = unescape(f[2]), c = unescape(f[3]), text = unescape(f[4]);
            ChannelDetails details = switch (source) {
                case SMS -> new ChannelDetails.Sms(a);
                case WHATSAPP -> new ChannelDetails.WhatsApp(a, b.contains("u"), b.contains("f"));
                case UPI -> new ChannelDetails.Upi(UpiRequestType.valueOf(a), b, c.isEmpty() ? null : new BigDecimal(c));
                case EMAIL -> new ChannelDetails.Email(a, b);
            };
            String result;
            try {
                AnalysisResult r = service.analyze(MessageInput.of(text, details));
                result = r.score() + "\t" + r.category() + "\t" + r.scamType().name() + "\t"
                        + r.indicators().stream().map(Harness::indicator).collect(Collectors.joining(" ¦ ")) + "\t"
                        + String.join(" ¦ ", r.recommendations());
            } catch (IllegalArgumentException e) {
                result = "ERROR";
            }
            out.append(escape(result)).append('\n');
        }
        System.out.write(out.toString().getBytes(StandardCharsets.UTF_8));
        System.out.flush();
    }

    private static String indicator(Indicator i) {
        Evidence e = i.evidence();
        return i.code() + ":" + i.weight() + ":" + i.group().name() + ":" + e.start() + "-" + e.end() + ":" + e.snippet() + ":" + i.explanation();
    }

    private static String unescape(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '\\' && i + 1 < s.length()) {
                char n = s.charAt(++i);
                b.append(switch (n) { case 't' -> '\t'; case 'n' -> '\n'; case 'r' -> '\r'; default -> n; });
            } else b.append(ch);
        }
        return b.toString();
    }

    private static String escape(String s) { return s.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r"); }
}
