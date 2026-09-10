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
class SiteHeaderTest {

    private final AemContext context = new AemContext();

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(SiteHeader.class, SiteHeader.NavItem.class);
    }

    @Test
    void testCompleteHeaderFiltersIncompleteItems() {
        Resource resource = context.create().resource("/content/header",
                "logoText", "Notion",
            "logoPath", "/content/dam/demo-ai-site/design/notion-mark.svg",
                "logoHref", "/product",
                "menuLabel", "Open navigation");
        context.create().resource(resource, "navItems/item0", "label", "Product", "href", "/product", "showCaret", true);
        context.create().resource(resource, "navItems/item1", "label", "Missing link");

        SiteHeader header = resource.adaptTo(SiteHeader.class);

        assertNotNull(header);
        assertEquals("Notion", header.getLogoText());
        assertEquals("/content/dam/demo-ai-site/design/notion-mark.svg", header.getLogoPath());
        assertEquals("/product", header.getLogoHref());
        assertEquals("Open navigation", header.getMenuLabel());
        assertEquals(1, header.getNavItems().size());
        assertTrue(header.getNavItems().get(0).isShowCaret());
        assertTrue(header.isHasContent());
    }

    @Test
    void testEmptyHeader() {
        SiteHeader header = context.create().resource("/content/header").adaptTo(SiteHeader.class);

        assertNotNull(header);
        assertEquals("Open menu", header.getMenuLabel());
        assertTrue(header.getNavItems().isEmpty());
        assertFalse(header.isHasContent());
    }
}