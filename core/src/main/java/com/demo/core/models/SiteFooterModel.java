package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class SiteFooterModel {

    @ValueMapValue
    private String quote;

    @ValueMapValue
    private String quoteAttribution;

    @ValueMapValue
    private String legalText;

    @ChildResource(name = "columns")
    private List<Resource> columnResources;

    @ChildResource(name = "legalLinks")
    private List<Resource> legalLinkResources;

    @ChildResource(name = "socialLinks")
    private List<Resource> socialLinkResources;

    private List<FooterColumn> columns;
    private List<NavItem> legalLinks;
    private List<NavItem> socialLinks;

    @PostConstruct
    protected void init() {
        columns = new ArrayList<>();
        if (columnResources != null) {
            for (Resource columnResource : columnResources) {
                FooterColumn column = columnResource.adaptTo(FooterColumn.class);
                if (column != null && column.isHasContent()) {
                    columns.add(column);
                }
            }
        }
        legalLinks = toNavItems(legalLinkResources);
        socialLinks = toNavItems(socialLinkResources);
    }

    private List<NavItem> toNavItems(List<Resource> resources) {
        List<NavItem> items = new ArrayList<>();
        if (resources != null) {
            for (Resource itemResource : resources) {
                NavItem item = itemResource.adaptTo(NavItem.class);
                if (item != null && item.isHasContent()) {
                    items.add(item);
                }
            }
        }
        return items;
    }

    public String getQuote() {
        return quote;
    }

    public String getQuoteAttribution() {
        return quoteAttribution;
    }

    public String getLegalText() {
        return legalText;
    }

    public List<FooterColumn> getColumns() {
        return Collections.unmodifiableList(columns);
    }

    public List<NavItem> getLegalLinks() {
        return Collections.unmodifiableList(legalLinks);
    }

    public List<NavItem> getSocialLinks() {
        return Collections.unmodifiableList(socialLinks);
    }

    public boolean isHasContent() {
        return quote != null || !columns.isEmpty() || !legalLinks.isEmpty();
    }
}
