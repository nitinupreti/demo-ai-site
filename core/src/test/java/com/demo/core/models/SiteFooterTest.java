package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class SiteFooterTest {
    private final AemContext context = new AemContext();

    @BeforeEach
    void setUp() { context.addModelsForClasses(SiteFooter.class, SiteFooter.LinkGroup.class, SiteFooter.Link.class); }

    @Test
    void testFooterFieldsAndLinks() {
        Resource resource = context.create().resource("/content/footer", "brandLabel", "Notion", "brandHref", "/product", "cookieLabel", "Cookie settings", "cookieHref", "/privacy", "languageLabel", "English (US)");
        context.create().resource(resource, "linkGroups/group0", "heading", "Product");
        context.create().resource("/content/footer/linkGroups/group0/links/link0", "label", "Features", "href", "/features");
        context.create().resource("/content/footer/linkGroups/group0/links/link1", "label", "Missing URL");
        SiteFooter footer = resource.adaptTo(SiteFooter.class);
        assertNotNull(footer);
        assertEquals("Notion", footer.getBrandLabel());
        assertEquals("Cookie settings", footer.getCookieLabel());
        assertEquals(1, footer.getLinkGroups().size());
        assertEquals(1, footer.getLinkGroups().get(0).getLinks().size());
        assertTrue(footer.isHasContent());
    }
}