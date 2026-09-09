package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class PullQuoteTest {

    private final AemContext context = new AemContext();

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(PullQuote.class);
    }

    @Test
    void testCompleteQuote() {
        Resource resource = context.create().resource("/content/quote",
                "quoteText", "A useful quote",
                "attributionName", "Ryo Lu",
                "attributionRole", "Head of Design",
                "attributionImage", "/content/dam/ryo.png",
                "attributionImageAlt", "Ryo Lu");

        PullQuote quote = resource.adaptTo(PullQuote.class);

        assertNotNull(quote);
        assertEquals("A useful quote", quote.getQuoteText());
        assertEquals("/content/dam/ryo.png", quote.getAttributionImage());
        assertEquals("Ryo Lu", quote.getAttributionImageAlt());
        assertTrue(quote.isHasContent());
    }

    @Test
    void testEmptyQuote() {
        PullQuote quote = context.create().resource("/content/quote").adaptTo(PullQuote.class);

        assertNotNull(quote);
        assertEquals("", quote.getAttributionImageAlt());
        assertFalse(quote.isHasContent());
    }
}