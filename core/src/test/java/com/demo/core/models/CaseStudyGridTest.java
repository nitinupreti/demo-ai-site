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
class CaseStudyGridTest {
    private final AemContext context = new AemContext();

    @BeforeEach
    void setUp() { context.addModelsForClasses(CaseStudyGrid.class, CaseStudyGrid.Tile.class); }

    @Test
    void testItemsFilterIncompleteRows() {
        Resource resource = context.create().resource("/content/grid", "sectionHeading", "Stories");
        context.create().resource(resource, "items/item0", "title", "Story", "href", "/story", "logoPath", "/content/dam/logo.svg", "logoAlt", "Logo");
        context.create().resource(resource, "items/item1", "title", "Missing URL");
        CaseStudyGrid grid = resource.adaptTo(CaseStudyGrid.class);
        assertNotNull(grid);
        assertEquals(1, grid.getItems().size());
        assertEquals("/content/dam/logo.svg", grid.getItems().get(0).getLogoPath());
        assertEquals("Logo", grid.getItems().get(0).getLogoAlt());
        assertTrue(grid.isHasContent());
    }
}